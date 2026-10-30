import * as THREE from 'three';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface SpecGlossExt {
  diffuseFactor?: [number, number, number, number];
  diffuseTexture?: { index: number };
  glossinessFactor?: number;
  specularGlossinessTexture?: { index: number };
}

/**
 * Older models (many on Sketchfab / Objaverse) use the retired "specular-glossiness" materials,
 * which three.js no longer reads: they would show up plain white. This turns them into normal
 * PBR materials: the diffuse picture becomes the color map, glossiness becomes roughness.
 */
export class SpecularGlossinessPlugin implements GLTFLoaderPlugin {
  readonly name = 'KHR_materials_pbrSpecularGlossiness';
  private readonly parser: GLTFParser;

  constructor(parser: GLTFParser) {
    this.parser = parser;
  }

  private ext(materialIndex: number): SpecGlossExt | undefined {
    const def = this.parser.json.materials?.[materialIndex] as { extensions?: Record<string, SpecGlossExt> } | undefined;
    return def?.extensions?.[this.name];
  }

  getMaterialType(materialIndex: number): typeof THREE.MeshStandardMaterial | null {
    return this.ext(materialIndex) ? THREE.MeshStandardMaterial : null;
  }

  extendMaterialParams(materialIndex: number, params: Record<string, unknown>): Promise<unknown> {
    const ext = this.ext(materialIndex);
    if (!ext) return Promise.resolve();
    const [r, g, b, a] = ext.diffuseFactor ?? [1, 1, 1, 1];
    params.color = new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    params.opacity = a;
    params.metalness = 0;
    // Glossy = smooth. A glossiness map would scale it per pixel; without one, use the factor as is.
    const gloss = ext.glossinessFactor ?? 1;
    params.roughness = THREE.MathUtils.clamp(1 - gloss * (ext.specularGlossinessTexture ? 0.5 : 1), 0.05, 1);
    const pending: Promise<unknown>[] = [];
    if (ext.diffuseTexture) pending.push(this.parser.assignTexture(params, 'map', ext.diffuseTexture, THREE.SRGBColorSpace));
    return Promise.all(pending);
  }
}
