import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

/* The AI model runs here, off the main thread, so the editor never freezes while it thinks. */
const handler = new WebWorkerMLCEngineHandler();

/*
 * Reading a long prompt in small pieces, each finished before the next. The model was built to
 * read 2048 words in one go: on a Mac that's one long job for the graphics chip, long enough that
 * the system resets it (and Chrome's drawing with it: the editor goes black). Small pieces keep
 * every job short. The answer is the same, it takes a little longer.
 */
const PIECE = 256;

interface Pipeline {
  prefillChunkSize: number;
  embedAndForward: (...args: unknown[]) => Promise<unknown>;
  tvm?: { webgpu?: () => { sync?: () => Promise<void> } };
  egeSmall?: boolean;
}

function smallPieces(): void {
  const pipelines = (handler.engine as unknown as { loadedModelIdToPipeline?: Map<string, Pipeline> }).loadedModelIdToPipeline;
  for (const p of pipelines?.values() ?? []) {
    if (p.egeSmall) continue;
    p.egeSmall = true;
    if (p.prefillChunkSize > PIECE) {
      console.info(`[EGE] reading prompts in pieces of ${PIECE} (the model was built for ${p.prefillChunkSize})`);
      p.prefillChunkSize = PIECE;
    }
    const forward = p.embedAndForward.bind(p);
    p.embedAndForward = async (...args) => {
      const out = await forward(...args);
      // Wait for the chip to finish this piece before queueing the next.
      await p.tvm?.webgpu?.().sync?.();
      return out;
    };
  }
}

self.onmessage = (msg: MessageEvent) => {
  smallPieces();
  handler.onmessage(msg);
};
