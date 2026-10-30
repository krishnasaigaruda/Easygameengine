import type { AssetResolver, ResolvedAsset } from './types';

/**
 * Test helper: a tiny glTF (one triangle + a 1-second "Bounce" animation) whose geometry lives
 * in a separate "buffers/tri.bin" file, like real exported models.
 */
export function makeTestGltfFiles(): Record<string, Uint8Array> {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const times = new Float32Array([0, 1]);
  const translations = new Float32Array([0, 0, 0, 0, 2, 0]);
  const bin = new Uint8Array(positions.byteLength + times.byteLength + translations.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(times.buffer), 36);
  bin.set(new Uint8Array(translations.buffer), 44);
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Tri', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ uri: 'buffers/tri.bin', byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    animations: [
      {
        name: 'Bounce',
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
        samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
      },
    ],
  };
  return { 'Tri.gltf': new TextEncoder().encode(JSON.stringify(gltf)), 'buffers/tri.bin': bin };
}

const toDataUrl = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:application/octet-stream;base64,${btoa(bin)}`;
};

/** Resolver over in-memory files (data: URLs work in Node's fetch). */
export class MemoryResolver implements AssetResolver {
  assets = new Map<string, Omit<ResolvedAsset, 'url' | 'files'> & { files: Record<string, Uint8Array> }>();
  delayMs = 0;
  async resolve(id: string): Promise<ResolvedAsset | undefined> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const a = this.assets.get(id);
    if (!a) return undefined;
    return {
      ...a,
      files: Object.keys(a.files),
      url: (path) => (a.files[path] ? toDataUrl(a.files[path]) : undefined),
    };
  }
}
