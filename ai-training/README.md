# Training the assistant's model

The AI assistant runs a small model in the browser. Training it on examples made from this
engine makes it much better at using the editor. Everything here is free except the Colab time.

## 1. Make the examples (on your computer, a few minutes)

    npm run ai:examples

Makes about 6,000 examples in a headless editor: real requests ("make Crate red", "add 5 coins
in a row", "give Door a script that opens on E"…) with answers built from the engine itself.
Each answer is run in the editor and kept only if it works. Output: `ai-training/data/train.jsonl`
and `eval.jsonl` (300 held back to test the trained model). More: `EXAMPLES=20000 npm run ai:examples`.

## 2. Train (Google Colab Pro, 1–3 hours)

1. Upload `train.jsonl` and `eval.jsonl` to **My Drive / EGE-AI /** in Google Drive.
2. In Colab: **File → Upload notebook →** `ai-training/train_qwen.ipynb`.
3. **Runtime → Change runtime type → L4** (or A100). High-RAM on if offered.
4. **Runtime → Run all.** Allow Google Drive when asked.

It trains Qwen3 4B, shows a few test answers, converts it for the browser and saves
**My Drive / EGE-AI / EGE-Builder-4B-v2-q4f16_1-MLC** (named after `MODEL_NAME` in the first cell:
give each training round a new name, since browsers keep old models by name). It also downloads it
as a zip. If Colab disconnects, Run all again: it carries on from the last checkpoint.

## 3. Put it in the engine

Unzip the download (or download the folder from Drive), then in the project:

    npm run pack:ai -- --local ~/Downloads/EGE-Builder-4B-v2-q4f16_1-MLC

Then delete the previous round's folder from `packages/editor/public/ai/` and its line in
`models.json`.

It shows up first in the AI sidebar as **Easy Game Engine Builder**. `npm run build` ships it with
the site (split into files under 24 MB, so Cloudflare Pages takes it).

## Next rounds

Tell the assistant things and note where it goes wrong. Those cases become new examples, and
training again makes the next version.
