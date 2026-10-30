import type { PictureReply, PictureRequest } from './pictureWorker';

/*
 * Reads pictures for the assistant: "build what's in this screenshot" needs it to know what's in
 * the screenshot. The picture model (~275 MB) downloads the first time a picture is attached,
 * stays in the browser, and leaves memory a little while after it's used.
 */

const IDLE_MS = 2 * 60_000;
let worker: Worker | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let next = 1;

/** Tests (dev build only): describe pictures without the model. */
let fake: ((picture: Blob) => string) | null = null;
export function setFakePictureReader(fn: typeof fake): void {
  if (import.meta.env.DEV) fake = fn;
}

/** What a picture shows, in a few sentences. `onProgress`: the first download, 0–1. */
export async function describePicture(picture: Blob, onProgress?: (fraction: number) => void): Promise<string> {
  if (fake) return fake(picture);
  clearTimeout(idle);
  worker ??= new Worker(new URL('./pictureWorker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = next++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const on = (e: MessageEvent<PictureReply>) => {
        if (e.data.id !== id) return;
        if (e.data.progress !== undefined) return onProgress?.(e.data.progress);
        w.removeEventListener('message', on);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.text ?? '');
      };
      w.addEventListener('message', on);
      w.postMessage({ id, picture } satisfies PictureRequest);
    });
  } finally {
    idle = setTimeout(() => {
      worker?.terminate();
      worker = null;
    }, IDLE_MS);
  }
}

/** Pictures among attached files. */
export const isPicture = (f: File) => f.type.startsWith('image/');
