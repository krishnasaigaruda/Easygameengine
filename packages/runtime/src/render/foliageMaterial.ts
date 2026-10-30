import * as THREE from 'three';

/**
 * Cut-out textures often hide white (or any color) under their see-through pixels. Shrunk
 * versions of the picture (used further away) mix that in, so thin blades turn pale. Fill the
 * see-through pixels with the average visible color first (what game engines call alpha bleeding).
 */
const solidCache = new WeakMap<THREE.Texture, THREE.Texture>();
function solidified(tex: THREE.Texture): THREE.Texture {
  const cached = solidCache.get(tex);
  if (cached) return cached;
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (typeof document === 'undefined' || !img?.width) return tex;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = data.data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 128) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
    }
    if (!n) return tex;
    r /= n;
    g /= n;
    b /= n;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 128) continue;
      // Keep the alpha; only the hidden color changes.
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
    // Straight from the pixels: a canvas would drop colors under fully clear pixels again.
    const out = new THREE.DataTexture(new Uint8Array(d.buffer), canvas.width, canvas.height, THREE.RGBAFormat);
    out.magFilter = THREE.LinearFilter;
    out.minFilter = THREE.LinearMipmapLinearFilter;
    out.generateMipmaps = true;
    out.needsUpdate = true;
    out.colorSpace = tex.colorSpace;
    out.wrapS = tex.wrapS;
    out.wrapT = tex.wrapT;
    out.flipY = tex.flipY;
    out.channel = tex.channel;
    out.offset.copy(tex.offset);
    out.repeat.copy(tex.repeat);
    out.anisotropy = 4;
    solidCache.set(tex, out);
    return out;
  } catch {
    return tex; // cross-origin or unreadable picture: draw it as it is
  }
}

/**
 * Painted plants drawn as cut-outs: a see-through material (grass blades, leaves) gets sharp
 * alpha-tested edges instead of blending (thousands of blended copies flicker and sort badly),
 * and is never metallic or glossy (exports often get these wrong, which makes leaves mirror the sky).
 */
const foliageCache = new WeakMap<THREE.Material, THREE.Material>();
export function asFoliage(material: THREE.Material): THREE.Material {
  const m = material as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || !(m.transparent || m.alphaTest > 0)) return material;
  let out = foliageCache.get(material);
  if (!out) {
    const c = m.clone();
    c.transparent = false;
    c.depthWrite = true;
    // 0.5: shrunk (far) versions of the picture blur alpha; lower cut-offs turn far tufts into blobs.
    c.alphaTest = Math.max(0.5, m.alphaTest);
    c.metalness = 0;
    c.metalnessMap = null;
    // Leaves aren't glossy either: a dark roughness map makes every blade a mirror of the sky.
    c.roughnessMap = null;
    c.roughness = Math.max(0.75, m.roughness);
    c.side = THREE.DoubleSide;
    if (c.map) c.map = solidified(c.map);
    foliageCache.set(material, c);
    out = c;
  }
  return out;
}
