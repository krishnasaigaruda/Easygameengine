import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/*
 * Optimize a model: many models repeat the same part (planks, posts, roof tiles) with a full copy
 * of its shape each time. Here each shape is kept once and every copy just says where it goes,
 * like objects placed in a scene. Pictures are saved compactly (JPEG unless they need see-through
 * pixels) and no bigger than `maxTextureSize`.
 */

export interface OptimizeReport {
  parts: number;
  shapes: number;
}

/** A fingerprint of a geometry's whole contents (same fingerprint: the same shape). */
export function geometryKey(g: THREE.BufferGeometry): string {
  let h = 0x811c9dc5;
  const mix = (arr: ArrayLike<number> & { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number }) => {
    const words = arr.buffer ? new Uint32Array(arr.buffer, arr.byteOffset ?? 0, Math.floor((arr.byteLength ?? 0) / 4)) : Uint32Array.from(arr as ArrayLike<number>);
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193);
  };
  const parts: string[] = [];
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    parts.push(`${name}:${a.count}x${a.itemSize}`);
    mix(a.array as Float32Array);
  }
  if (g.index) {
    parts.push(`i:${g.index.count}`);
    mix(g.index.array as Uint32Array);
  }
  parts.push(g.groups.map((gr) => `${gr.start},${gr.count},${gr.materialIndex}`).join(';'));
  return `${parts.join('|')}#${(h >>> 0).toString(36)}`;
}

/** Share one geometry between every part with the same shape. Returns how many parts and shapes. */
export function shareRepeatedShapes(root: THREE.Object3D): OptimizeReport {
  const shapes = new Map<string, THREE.BufferGeometry>();
  let parts = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences) return;
    parts++;
    const key = geometryKey(mesh.geometry);
    const shared = shapes.get(key);
    if (!shared) shapes.set(key, mesh.geometry);
    else if (shared !== mesh.geometry) mesh.geometry = shared;
  });
  return { parts, shapes: shapes.size };
}

/** Does the picture really have see-through pixels? (Many are saved with an unused alpha channel.) */
function imageHasAlpha(image: unknown): boolean {
  const img = image as CanvasImageSource & { width?: number; height?: number };
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h || typeof document === 'undefined') return true;
  const scale = Math.min(1, 256 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return true;
  try {
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
  } catch {
    return true;
  }
  return false;
}

/** Does this texture need see-through pixels (so it must stay PNG)? Only colour/alpha maps can. */
function needsAlpha(root: THREE.Object3D, tex: THREE.Texture): boolean {
  let colour = false;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.map === tex || std.alphaMap === tex) colour = true;
    }
  });
  return colour && imageHasAlpha(tex.image);
}

/** The model as a compact .glb, keeping its animations (models with a skeleton: use the original). */
export async function optimizedGlb(root: THREE.Object3D, animations: THREE.AnimationClip[] = [], maxTextureSize = 2048): Promise<{ blob: Blob; report: OptimizeReport }> {
  const report = shareRepeatedShapes(root);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(m)) {
        const tex = value as THREE.Texture | null;
        if (tex?.isTexture) tex.userData.mimeType = needsAlpha(root, tex) ? 'image/png' : 'image/jpeg';
      }
    }
  });
  const out = (await new GLTFExporter().parseAsync(root, { binary: true, maxTextureSize, onlyVisible: false, animations })) as ArrayBuffer;
  return { blob: new Blob([out], { type: 'model/gltf-binary' }), report };
}
