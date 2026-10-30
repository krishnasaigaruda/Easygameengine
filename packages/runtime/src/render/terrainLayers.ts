import * as THREE from 'three';
import { SPLAT_LAYERS } from '../terrain/heightmap';

/** Pixel size of each layer's color picture and of its surface detail. */
const ALBEDO_SIZE = 1024;
const DETAIL_SIZE = 512;

type Drawable = CanvasImageSource & { width: number; height: number };

/** A 2D canvas to copy pictures through (null without a browser: tests keep the defaults). */
function canvas2d(size: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      return c.getContext('2d', { willReadFrequently: true });
    }
  } catch {
    // no canvas
  }
  return null;
}

/** A texture's picture, if it is one we can draw (image, bitmap, canvas). */
function drawable(t: THREE.Texture | null | undefined): Drawable | null {
  const img = t?.image as Drawable | undefined;
  if (!img || typeof img !== 'object' || !('width' in img) || !img.width) return null;
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return img;
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return img;
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return img;
  if (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas) return img;
  return null;
}

function pixels(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, img: Drawable, size: number): Uint8ClampedArray {
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

/**
 * The terrain's paint layers on the GPU: two texture arrays (one picture per layer), so all 8
 * layers fit in a few texture slots.
 *  - albedo: the layer's color picture (white when it has none: its color tints it instead).
 *  - detail: surface normal (R, G), roughness (B) and height (A, for blending: pebbles poke
 *    through grass instead of fading into it).
 */
export class TerrainLayerTextures {
  readonly albedo: THREE.DataArrayTexture;
  readonly detail: THREE.DataArrayTexture;
  private readonly ctxA = canvas2d(ALBEDO_SIZE);
  private readonly ctxD = canvas2d(DETAIL_SIZE);

  constructor() {
    const a = new Uint8Array(ALBEDO_SIZE * ALBEDO_SIZE * 4 * SPLAT_LAYERS).fill(255);
    this.albedo = new THREE.DataArrayTexture(a, ALBEDO_SIZE, ALBEDO_SIZE, SPLAT_LAYERS);
    this.albedo.colorSpace = THREE.SRGBColorSpace;
    const d = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4 * SPLAT_LAYERS);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 128; // flat normal
      d[i + 1] = 128;
      d[i + 2] = 235; // rough
      d[i + 3] = 128; // mid height
    }
    this.detail = new THREE.DataArrayTexture(d, DETAIL_SIZE, DETAIL_SIZE, SPLAT_LAYERS);
    for (const t of [this.albedo, this.detail]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
  }

  /** Put a material's pictures into one layer (null: plain layer, tinted by its color). */
  setLayer(layer: number, material: THREE.MeshStandardMaterial | null): void {
    this.setAlbedo(layer, drawable(material?.map));
    this.setDetail(layer, material);
  }

  private setAlbedo(layer: number, img: Drawable | null): void {
    const size = ALBEDO_SIZE;
    const out = (this.albedo.image.data as Uint8Array).subarray(layer * size * size * 4, (layer + 1) * size * size * 4);
    if (img && this.ctxA) out.set(pixels(this.ctxA, img, size));
    else out.fill(255);
    this.albedo.addLayerUpdate(layer);
    this.albedo.needsUpdate = true;
  }

  private setDetail(layer: number, m: THREE.MeshStandardMaterial | null): void {
    const size = DETAIL_SIZE;
    const out = (this.detail.image.data as Uint8Array).subarray(layer * size * size * 4, (layer + 1) * size * size * 4);
    const ctx = this.ctxD;
    const normal = ctx && drawable(m?.normalMap) ? pixels(ctx, drawable(m!.normalMap)!, size).slice() : null;
    const rough = ctx && drawable(m?.roughnessMap) ? pixels(ctx, drawable(m!.roughnessMap)!, size).slice() : null;
    const heightTex = (m?.userData.heightMap as THREE.Texture | undefined) ?? m?.displacementMap;
    const height = ctx && drawable(heightTex) ? pixels(ctx, drawable(heightTex)!, size).slice() : null;
    const color = ctx && drawable(m?.map) ? pixels(ctx, drawable(m!.map)!, size).slice() : null;
    const roughness = Math.round(THREE.MathUtils.clamp(m?.roughness ?? 0.92, 0, 1) * 255);
    for (let i = 0; i < size * size; i++) {
      const k = i * 4;
      out[k] = normal ? normal[k] : 128;
      out[k + 1] = normal ? normal[k + 1] : 128;
      // glTF roughness lives in the green channel; a factor scales it.
      out[k + 2] = rough ? Math.round(rough[k + 1] * (m?.roughness ?? 1)) : roughness;
      // Height: the real height map if there is one, else brightness (stones are lighter than gaps).
      out[k + 3] = height ? height[k] : color ? Math.round(color[k] * 0.3 + color[k + 1] * 0.55 + color[k + 2] * 0.15) : 128;
    }
    this.detail.addLayerUpdate(layer);
    this.detail.needsUpdate = true;
  }

  dispose(): void {
    this.albedo.dispose();
    this.detail.dispose();
  }
}
