import { Florence2ForConditionalGeneration, AutoProcessor, RawImage, type PreTrainedModel, type Processor } from '@huggingface/transformers';

/*
 * The picture reader: Florence-2 (a small picture model) writes what a picture shows, in words,
 * so the assistant (which only reads text) can build from it. Runs here, off the main thread, on
 * the processor: the graphics chip is the builder's, and sharing it would make the computer lag.
 */

const MODEL = 'onnx-community/Florence-2-base-ft';
const TASK = '<MORE_DETAILED_CAPTION>';

export type PictureRequest = { id: number; picture: Blob };
export type PictureReply = { id: number; progress?: number; text?: string; error?: string };

let loaded: Promise<{ model: PreTrainedModel; processor: Processor }> | null = null;

function load(report: (fraction: number) => void) {
  loaded ??= (async () => {
    // Every file's progress, as one fraction.
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let done = 0;
      let all = 0;
      for (const f of files.values()) {
        done += f.loaded;
        all += f.total;
      }
      report(all ? done / all : 0);
    };
    const q8 = 'q8' as const; // 8-bit: ~275 MB, the processor runs it well
    const dtype = { embed_tokens: q8, vision_encoder: q8, encoder_model: q8, decoder_model_merged: q8 };
    const [model, processor] = await Promise.all([
      Florence2ForConditionalGeneration.from_pretrained(MODEL, { dtype: dtype as never, device: 'wasm', progress_callback: progress_callback as never }),
      AutoProcessor.from_pretrained(MODEL),
    ]);
    return { model, processor };
  })();
  loaded.catch(() => (loaded = null));
  return loaded;
}

self.onmessage = async (msg: MessageEvent<PictureRequest>) => {
  const { id, picture } = msg.data;
  const reply = (r: Omit<PictureReply, 'id'>) => self.postMessage({ id, ...r } satisfies PictureReply);
  let stage = 'loading the picture reader';
  try {
    const { model, processor } = await load((progress) => reply({ progress }));
    stage = 'reading the picture';
    // Plain colours (screenshots can carry see-through).
    const image = (await RawImage.fromBlob(picture)).rgb();
    const inputs = await (processor as unknown as (img: RawImage, text: string) => Promise<Record<string, unknown>>)(image, TASK);
    stage = 'describing it';
    const ids = (await model.generate({ ...inputs, max_new_tokens: 160 } as never)) as unknown;
    const tokenizer = (processor as unknown as { tokenizer: { batch_decode(t: unknown, o: object): string[] } }).tokenizer;
    const raw = tokenizer.batch_decode(ids, { skip_special_tokens: false })[0];
    const done = (processor as unknown as { post_process_generation(t: string, task: string, size: [number, number]): Record<string, string> }).post_process_generation(raw, TASK, image.size as [number, number]);
    reply({ text: String(done[TASK] ?? raw).trim() });
  } catch (err) {
    reply({ error: `${stage}: ${err instanceof Error ? err.message : String(err)}` });
  }
};
