#!/usr/bin/env python3
"""Converts a merged (16-bit) Hugging Face Qwen3 model to WebLLM's q4f16_1 weights.

Writes params_shard_*.bin and tensor-cache.json in the same layout as mlc-ai/Qwen3-4B-q4f16_1-MLC, so
the prebuilt Qwen3 4B browser library runs it. It does what `mlc_llm convert_weight --quantization q4f16_1`
does, with only numpy (that command can crash while compiling its quantize step).

  python convert_to_webllm.py <merged model folder> <output folder>

The output folder also needs mlc-chat-config.json and the tokenizer files: `mlc_llm gen_config` makes those.
"""
import hashlib
import json
import os
import struct
import sys

import numpy as np

GROUP = 32          # values per scale
MAX_INT = 7         # int4 values are stored as 0..14, 7 meaning zero
PER_WORD = 8        # int4 values per uint32
SHARD_BYTES = 32 * 1024 * 1024
ROWS_AT_ONCE = 8192


def open_weights(folder):
    """Every tensor in the folder's .safetensors files: name -> (file, dtype, shape, start, end)."""
    tensors = {}
    for file in sorted(f for f in os.listdir(folder) if f.endswith(".safetensors")):
        path = os.path.join(folder, file)
        with open(path, "rb") as f:
            size = struct.unpack("<Q", f.read(8))[0]
            header = json.loads(f.read(size))
        for name, t in header.items():
            if name != "__metadata__":
                start, end = t["data_offsets"]
                tensors[name] = (path, t["dtype"], t["shape"], 8 + size + start, 8 + size + end)
    return tensors


def read_f16(entry):
    """A tensor as float16, the way MLC reads it (bfloat16 goes through float32)."""
    path, dtype, shape, start, end = entry
    raw = np.memmap(path, dtype=np.uint8, mode="r", offset=start, shape=(end - start,))
    if dtype == "BF16":
        f32 = (raw.view(np.uint16).astype(np.uint32) << 16).view(np.float32)
    elif dtype == "F16":
        return np.array(raw.view(np.float16)).reshape(shape)
    elif dtype == "F32":
        f32 = raw.view(np.float32)
    else:
        raise ValueError(f"Unsupported weight type {dtype}")
    return f32.astype(np.float16).reshape(shape)


def quantize(w):
    """q4f16_1: groups of 32 along each row, scale = max |w| / 7, values packed 8 per uint32 (lowest bits first).

    Each step rounds to float16 like MLC's float16 kernel (which multiplies by 1/7 and rounds halves up), so the
    result is bit-for-bit what `mlc_llm convert_weight` writes."""
    rows, cols = w.shape
    assert cols % GROUP == 0, f"row length {cols} is not a multiple of {GROUP}"
    q_weight = np.empty((rows, cols // PER_WORD), np.uint32)
    q_scale = np.empty((rows, cols // GROUP), np.float16)
    inv_max = np.float32(np.float16(1 / MAX_INT))
    for r in range(0, rows, ROWS_AT_ONCE):
        g = w[r:r + ROWS_AT_ONCE].reshape(-1, cols // GROUP, GROUP)
        scale = (np.abs(g).max(-1).astype(np.float32) * inv_max).astype(np.float16)
        x = (g.astype(np.float32) / scale.astype(np.float32)[..., None]).astype(np.float16)
        x = (x.astype(np.float32) + np.float32(MAX_INT)).astype(np.float16)
        q = np.clip(np.floor(x.astype(np.float32) + 0.5), 0, 2 * MAX_INT).astype(np.uint32)
        q = q.reshape(q.shape[0], cols // PER_WORD, PER_WORD) << (np.arange(PER_WORD, dtype=np.uint32) * 4)
        q_weight[r:r + ROWS_AT_ONCE] = np.bitwise_or.reduce(q, axis=-1)
        q_scale[r:r + ROWS_AT_ONCE] = scale
    return q_weight, q_scale


def browser_tensors(weights, config):
    """(name, array) for every tensor the Qwen3 browser model loads, with MLC's joined layers."""
    get = lambda name: read_f16(weights[name])

    def quantized(name, w):
        q_weight, q_scale = quantize(w)
        yield f"{name}.q_weight", q_weight
        yield f"{name}.q_scale", q_scale

    yield from quantized("model.embed_tokens", get("model.embed_tokens.weight"))
    for i in range(config["num_hidden_layers"]):
        p = f"model.layers.{i}"
        yield f"{p}.input_layernorm.weight", get(f"{p}.input_layernorm.weight")
        yield f"{p}.post_attention_layernorm.weight", get(f"{p}.post_attention_layernorm.weight")
        yield f"{p}.self_attn.q_norm.weight", get(f"{p}.self_attn.q_norm.weight")
        yield f"{p}.self_attn.k_norm.weight", get(f"{p}.self_attn.k_norm.weight")
        qkv = np.concatenate([get(f"{p}.self_attn.{x}_proj.weight") for x in "qkv"])
        yield from quantized(f"{p}.self_attn.c_attn", qkv)
        yield from quantized(f"{p}.self_attn.o_proj", get(f"{p}.self_attn.o_proj.weight"))
        gate_up = np.concatenate([get(f"{p}.mlp.gate_proj.weight"), get(f"{p}.mlp.up_proj.weight")])
        yield from quantized(f"{p}.mlp.gate_up_proj", gate_up)
        yield from quantized(f"{p}.mlp.down_proj", get(f"{p}.mlp.down_proj.weight"))
    yield "model.norm.weight", get("model.norm.weight")
    if not config.get("tie_word_embeddings", True):
        yield from quantized("lm_head", get("lm_head.weight"))


def convert(src, out):
    config = json.load(open(os.path.join(src, "config.json")))
    if config.get("model_type") != "qwen3":
        raise ValueError(f"Expected a qwen3 model, got {config.get('model_type')}")
    weights = open_weights(src)
    os.makedirs(out, exist_ok=True)
    shards, shard, shard_bytes = [], [], 0

    def flush():
        nonlocal shard, shard_bytes
        if not shard:
            return
        path = f"params_shard_{len(shards)}.bin"
        md5 = hashlib.md5()
        records, offset = [], 0
        with open(os.path.join(out, path), "wb") as f:
            for name, a in shard:
                data = np.ascontiguousarray(a).tobytes()
                f.write(data)
                md5.update(data)
                records.append({"name": name, "shape": list(a.shape), "dtype": str(a.dtype), "format": "f32-to-bf16",
                                "nbytes": len(data), "byteOffset": offset})
                offset += len(data)
        shards.append({"dataPath": path, "format": "raw-shard", "nbytes": offset, "records": records,
                       "md5sum": md5.hexdigest()})
        shard, shard_bytes = [], 0

    count = 0
    for name, a in browser_tensors(weights, config):
        if shard and shard_bytes + a.nbytes > SHARD_BYTES:
            flush()
        shard.append((name, a))
        shard_bytes += a.nbytes
        count += 1
        print(f"\r{count} tensors", end="", flush=True)
    flush()
    print()

    total = sum(s["nbytes"] for s in shards)
    source_params = sum(int(np.prod(t[2])) for n, t in weights.items()
                        if not (n == "lm_head.weight" and config.get("tie_word_embeddings", True)))
    meta = {"ParamSize": count, "ParamBytes": float(total), "BitsPerParam": total * 8 / source_params}
    with open(os.path.join(out, "tensor-cache.json"), "w") as f:
        json.dump({"metadata": meta, "records": shards}, f, indent=2)
    print(f"{count} tensors, {len(shards)} shards, {total / 2**30:.2f} GB -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    convert(sys.argv[1], sys.argv[2])
