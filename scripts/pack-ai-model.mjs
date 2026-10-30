#!/usr/bin/env node
/*
 * Packs the AI assistant's model so it ships with the editor on any static host (Cloudflare
 * Pages, GitHub Pages, Netlify…), whose files are limited to ~25 MB each.
 *
 *   node scripts/pack-ai-model.mjs [model-id …]      (default: the small Qwen2.5 0.5B)
 *   node scripts/pack-ai-model.mjs --local <folder> [--label "Name"] [--lib <file.wasm>]
 *        a model you trained (ai-training/train_qwen.ipynb): the WebLLM folder from your Drive
 *
 * It downloads the WebLLM build of the model from Hugging Face once, then:
 *   - repacks the weights by tensor into files under 24 MB (WebLLM reads them as they are);
 *   - a tensor bigger than that on its own (the word table) is cut into parts, which the editor
 *     joins back together when someone downloads the model;
 *   - copies the small files (config, tokenizer) and the model's WebGPU library.
 * Output: packages/editor/public/ai/ (not in git; rebuilt when missing).
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/editor/public/ai');
const LIMIT = 24 * 1024 * 1024;
const DEFAULT_MODELS = ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC'];
/** The WebGPU library of each model, as WebLLM's own list names it. */
const LIB_PREFIX = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/';
const LIBS = {
  'Qwen3.5-4B-q4f16_1-MLC': 'Qwen3.5-4B-q4f16_1_cs1k-webgpu.wasm',
  'Qwen3.5-4B-q4f32_1-MLC': 'Qwen3.5-4B-q4f32_1_cs1k-webgpu.wasm',
  'Qwen3-8B-q4f16_1-MLC': 'Qwen3-8B-q4f16_1_cs1k-webgpu.wasm',
  'Qwen3-8B-q4f32_1-MLC': 'Qwen3-8B-q4f32_1_cs1k-webgpu.wasm',
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': 'Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm',
  'Qwen2.5-0.5B-Instruct-q4f32_1-MLC': 'Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC': 'Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm',
  'Qwen2.5-1.5B-Instruct-q4f32_1-MLC': 'Qwen2-1.5B-Instruct-q4f32_1_cs1k-webgpu.wasm',
};

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/** Files come from Hugging Face, or (a model you trained) from a folder on this computer. */
let localDir = null;
async function get(url) {
  if (localDir) {
    const name = url.split('/').pop();
    return readFile(join(localDir, name));
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`, { cause: err });
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const options = {};
async function pack(modelId) {
  const lib = options.lib ?? LIBS[modelId];
  if (!lib) throw new Error(`Unknown model ${modelId}. Known: ${Object.keys(LIBS).join(', ')}`);
  const hf = `https://huggingface.co/mlc-ai/${modelId}/resolve/main/`;
  // WebLLM turns a model address into <address>/resolve/main/<file>: keep that layout.
  const dir = join(OUT, modelId, 'resolve/main');
  const done = join(OUT, modelId, 'manifest.json');
  if (existsSync(done)) {
    console.log(`${modelId}: already packed`);
    return JSON.parse(await readFile(done, 'utf8'));
  }
  await rm(join(OUT, modelId), { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const files = localDir ? (await import('node:fs/promises')).readdir(localDir) : JSON.parse((await get(`https://huggingface.co/api/models/mlc-ai/${modelId}`)).toString()).siblings.map((s) => s.rfilename);
  const small = (await files).filter((f) => !/^params_shard_\d+\.bin$/.test(f) && f !== 'tensor-cache.json' && f !== 'ndarray-cache.json' && !f.startsWith('.') && f !== 'README.md');
  for (const f of small) {
    const buf = await get(hf + f);
    if (buf.length > LIMIT) throw new Error(`${f} is ${mb(buf.length)}: too big to host`);
    await writeFile(join(dir, f), buf);
  }

  // Repack the weights by tensor.
  const cache = JSON.parse((await get(hf + 'tensor-cache.json')).toString());
  const shards = [];
  let current = null;
  const joined = [];
  const close = () => {
    if (current) shards.push(current);
    current = null;
  };
  let total = 0;
  for (const shard of cache.records) {
    process.stdout.write(`${modelId}: ${shard.dataPath} (${mb(shard.nbytes)})… `);
    const data = await get(hf + shard.dataPath);
    for (const t of shard.records) {
      const bytes = data.subarray(t.byteOffset, t.byteOffset + t.nbytes);
      total += bytes.length;
      if (bytes.length > LIMIT) {
        // Too big for one file even alone: its own shard, cut into parts.
        close();
        shards.push({ tensors: [{ ...t, byteOffset: 0 }], chunks: [bytes], size: bytes.length, split: true });
        continue;
      }
      if (current && current.size + bytes.length > LIMIT) close();
      current ??= { tensors: [], chunks: [], size: 0, split: false };
      current.tensors.push({ ...t, byteOffset: current.size });
      current.chunks.push(bytes);
      current.size += bytes.length;
    }
    console.log('ok');
  }
  close();

  const records = [];
  for (const [i, s] of shards.entries()) {
    const name = `params_shard_${i}.bin`;
    const body = Buffer.concat(s.chunks);
    records.push({ dataPath: name, format: 'raw-shard', nbytes: body.length, records: s.tensors });
    if (!s.split) {
      await writeFile(join(dir, name), body);
      continue;
    }
    const parts = [];
    for (let off = 0, k = 0; off < body.length; off += LIMIT, k++) {
      const part = `${name}.part${k}`;
      await writeFile(join(dir, part), body.subarray(off, off + LIMIT));
      parts.push(part);
    }
    joined.push({ file: name, parts, bytes: body.length });
  }
  await writeFile(join(dir, 'tensor-cache.json'), JSON.stringify({ metadata: cache.metadata, records }));
  // A trained model is a changed Qwen3: Apache-2.0 asks for a notice saying so next to it.
  if (localDir) await writeFile(join(dir, 'NOTICE.txt'), `${options.label ?? modelId}\n\nA modified version of Qwen3-4B (Copyright Alibaba Cloud, Qwen team), licensed under the Apache License 2.0:\nhttps://huggingface.co/Qwen/Qwen3-4B/blob/main/LICENSE\n\nChanges: fine-tuned with LoRA on examples made with Easy Game Engine, merged, and converted to WebLLM's q4f16_1 format.\n`);

  const libDir = join(OUT, 'libs');
  await mkdir(libDir, { recursive: true });
  if (!existsSync(join(libDir, lib))) {
    const keep = localDir;
    localDir = null; // the library always comes from WebLLM's own builds
    await writeFile(join(libDir, lib), await get(LIB_PREFIX + lib));
    localDir = keep;
  }

  const manifest = { id: modelId, lib: `libs/${lib}`, bytes: total + (await stat(join(libDir, lib))).size, joined, ...(options.label ? { label: options.label, custom: true } : {}) };
  await writeFile(done, JSON.stringify(manifest, null, 2));
  console.log(`${modelId}: ${records.length} files (largest under ${mb(LIMIT)}), ${joined.length} split into parts, ${mb(total)} in all`);
  return manifest;
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const local = flag('--local');
options.label = flag('--label');
options.lib = flag('--lib');
if (process.env.EGE_SKIP_AI_MODEL && !local) {
  console.log('EGE_SKIP_AI_MODEL is set: not packing the AI model (the editor will use Hugging Face).');
  process.exit(0);
}
await mkdir(OUT, { recursive: true });
// What's already packed stays (a trained model sits next to the built-in ones).
let packed = [];
try {
  packed = JSON.parse(await readFile(join(OUT, 'models.json'), 'utf8'));
} catch {
  packed = [];
}
const add = (m) => (packed = [...packed.filter((p) => p.id !== m.id), m]);
if (local) {
  localDir = local.replace(/^~/, process.env.HOME ?? '~');
  const id = localDir.replace(/\/+$/, '').split('/').pop();
  options.label ??= 'Easy Game Engine Builder';
  options.lib ??= 'Qwen3-4B-q4f16_1_cs1k-webgpu.wasm';
  await rm(join(OUT, id), { recursive: true, force: true }); // a new training round replaces the old one
  add(await pack(id));
} else {
  for (const m of args.length ? args : DEFAULT_MODELS) add(await pack(m));
}
await writeFile(join(OUT, 'models.json'), JSON.stringify(packed.map(({ id, lib, bytes, joined, label, custom }) => ({ id, lib, bytes, joined, label, custom })), null, 2));
console.log(`Wrote ${join('packages/editor/public/ai', 'models.json')}`);
