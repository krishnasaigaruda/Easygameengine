import * as THREE from 'three';
import { applyClipEvents } from '../render/clipEvents';
import { buildMaterial } from '../render/shaders';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SpecularGlossinessPlugin } from './specGloss';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EventBus } from '../core/EventBus';
import {
  defaultMaterialData,
  extensionOf,
  type AssetResolver,
  type MaterialAssetData,
  type ResolvedAsset,
} from './types';

/** Draco-compressed meshes need a decoder; only fetched if a model actually uses Draco. */
const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const SCHEME = 'ege-asset://';

export interface LoadedModel {
  /** Template scene — never add this to the world directly; use `instantiate()`. */
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Bounding box of the template in its own space (for auto-fitting new models). */
  bounds: THREE.Box3;
}

export interface AssetEvents {
  /** An asset's content changed or was deleted; systems should reload anything using it. */
  changed: { id: string };
}

/**
 * Loads and caches assets via an AssetResolver. Loaders get a virtual URL
 * (ege-asset://<id>/<path>) so relative references inside model files (textures, .bin
 * buffers, .mtl) resolve to the asset's other files, wherever they're stored.
 */
export class AssetManager {
  readonly events = new EventBus<AssetEvents>();
  resolver: AssetResolver | null = null;
  private readonly models = new Map<string, Promise<LoadedModel>>();
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly materials = new Map<string, Promise<THREE.Material>>();
  private readonly environments = new Map<string, Promise<THREE.Texture>>();
  private readonly texts = new Map<string, Promise<string>>();
  private draco: DRACOLoader | null = null;

  async resolve(id: string): Promise<ResolvedAsset> {
    if (!this.resolver) throw new Error('No asset resolver configured');
    const asset = await this.resolver.resolve(id);
    if (!asset) throw new Error(`Asset ${id} not found`);
    return asset;
  }

  loadModel(id: string): Promise<LoadedModel> {
    return this.cached(this.models, id, async () => {
      const asset = await this.resolve(id);
      if (asset.type !== 'model') throw new Error(`"${asset.name}" is not a model`);
      const model = await this.parseModel(asset);
      applyClipEvents(model.animations, asset.data); // code points on its animations
      return model;
    });
  }

  /** Fresh copy of a model (skinned meshes get their own skeleton). */
  async instantiate(id: string): Promise<{ object: THREE.Object3D; animations: THREE.AnimationClip[] }> {
    const model = await this.loadModel(id);
    const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
    return { object: clone(model.scene), animations: model.animations };
  }

  loadTexture(id: string, srgb = true): Promise<THREE.Texture> {
    return this.cached(this.textures, `${id}:${srgb ? 'srgb' : 'linear'}`, async () => {
      const asset = await this.resolve(id);
      const url = asset.url(asset.main);
      if (!url) throw new Error(`Texture "${asset.name}" has no file`);
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      tex.name = asset.name;
      return tex;
    });
  }

  /** Material assets are shared: every mesh using one gets the same THREE material. */
  loadMaterial(id: string): Promise<THREE.Material> {
    return this.cached(this.materials, id, async () => {
      const asset = await this.resolve(id);
      if (asset.type !== 'material') throw new Error(`"${asset.name}" is not a material`);
      const d: MaterialAssetData = { ...defaultMaterialData(), ...(asset.data as Partial<MaterialAssetData>) };
      const slot = async (texId: string, srgb: boolean) => {
        if (!texId) return null;
        try {
          const t = (await this.loadTexture(texId, srgb)).clone();
          t.repeat.set(d.tiling[0], d.tiling[1]);
          t.needsUpdate = true;
          return t;
        } catch (err) {
          console.error(`[EGE] material "${asset.name}": texture failed:`, err);
          return null;
        }
      };
      const [map, normalMap, roughnessMap, metalnessMap, aoMap, heightMap] = await Promise.all([
        slot(d.map, true),
        slot(d.normalMap, false),
        slot(d.roughnessMap, false),
        slot(d.metalnessMap, false),
        slot(d.aoMap, false),
        slot(d.heightMap ?? '', false),
      ]);
      const material = buildMaterial(d, { map, normalMap, roughnessMap, metalnessMap, aoMap }, asset.name);
      // Kept aside (not as a displacement map, which would move the mesh's vertices).
      if (heightMap) material.userData.heightMap = heightMap;
      return material;
    });
  }

  /** Equirectangular HDR/EXR sky; the renderer turns it into image-based lighting. */
  loadEnvironment(id: string): Promise<THREE.Texture> {
    return this.cached(this.environments, id, async () => {
      const asset = await this.resolve(id);
      const url = asset.url(asset.main);
      if (!url) throw new Error(`Sky "${asset.name}" has no file`);
      const ext = extensionOf(asset.main);
      let tex: THREE.Texture;
      if (ext === 'exr') tex = await new EXRLoader().loadAsync(url);
      else if (ext === 'hdr') tex = await new HDRLoader().loadAsync(url);
      else {
        tex = await new THREE.TextureLoader().loadAsync(url);
        tex.colorSpace = THREE.SRGBColorSpace;
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.name = asset.name;
      return tex;
    });
  }

  /** The main file as text (EasyScript sources). */
  loadText(id: string): Promise<string> {
    return this.cached(this.texts, id, async () => {
      const asset = await this.resolve(id);
      const url = asset.url(asset.main);
      if (!url) throw new Error(`"${asset.name}" has no file`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't read "${asset.name}" (HTTP ${res.status})`);
      return res.text();
    });
  }

  /** Drop cached copies so the next load re-reads the asset. */
  invalidate(id: string): void {
    for (const cache of [this.models, this.textures, this.materials, this.environments, this.texts]) {
      for (const key of [...cache.keys()]) if (key === id || key.startsWith(`${id}:`)) cache.delete(key);
    }
    this.events.emit('changed', { id });
  }

  /**
   * Forget every cached asset without notifying anyone — for switching projects, when the
   * whole scene is about to be replaced (reloading the old scene's assets would just fail).
   */
  reset(): void {
    this.texts.clear();
    this.models.clear();
    this.textures.clear();
    this.materials.clear();
    this.environments.clear();
  }

  dispose(): void {
    this.draco?.dispose();
    for (const p of this.textures.values()) void p.then((t) => t.dispose(), () => {});
    for (const p of this.materials.values()) void p.then((m) => m.dispose(), () => {});
    for (const p of this.environments.values()) void p.then((t) => t.dispose(), () => {});
    this.models.clear();
    this.textures.clear();
    this.materials.clear();
    this.environments.clear();
  }

  private cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    let p = cache.get(key);
    if (!p) {
      p = load();
      cache.set(key, p);
      // Failed loads shouldn't stick: let the user fix the asset and retry.
      p.catch(() => cache.get(key) === p && cache.delete(key));
    }
    return p;
  }

  private loadingManagerFor(asset: ResolvedAsset): THREE.LoadingManager {
    const manager = new THREE.LoadingManager();
    const prefix = `${SCHEME}${asset.id}/`;
    manager.setURLModifier((url) => {
      if (!url.startsWith(prefix)) return url;
      const path = decodeURIComponent(url.slice(prefix.length));
      return findFileUrl(asset, path) ?? url;
    });
    return manager;
  }

  private async parseModel(asset: ResolvedAsset): Promise<LoadedModel> {
    const manager = this.loadingManagerFor(asset);
    const virtualUrl = `${SCHEME}${asset.id}/${asset.main.split('/').map(encodeURIComponent).join('/')}`;
    const ext = extensionOf(asset.main);
    let scene: THREE.Object3D;
    let animations: THREE.AnimationClip[] = [];

    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader(manager);
      loader.register((parser) => new SpecularGlossinessPlugin(parser));
      loader.setMeshoptDecoder(MeshoptDecoder);
      this.draco ??= new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH);
      loader.setDRACOLoader(this.draco);
      const gltf = await loader.loadAsync(virtualUrl);
      scene = gltf.scene;
      animations = gltf.animations;
    } else if (ext === 'fbx') {
      const fbx = await new FBXLoader(manager).loadAsync(virtualUrl);
      scene = fbx;
      animations = fbx.animations;
    } else if (ext === 'obj') {
      const loader = new OBJLoader(manager);
      const mtlPath = asset.main.replace(/\.obj$/i, '.mtl');
      if (findFileUrl(asset, mtlPath)) {
        const materials = await new MTLLoader(manager).loadAsync(`${SCHEME}${asset.id}/${mtlPath}`);
        materials.preload();
        loader.setMaterials(materials);
      }
      scene = await loader.loadAsync(virtualUrl);
    } else {
      throw new Error(`Unsupported model format ".${ext}"`);
    }

    scene.name = asset.name;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Old formats sometimes ship Phong/Lambert; upgrade so they react to realistic lighting.
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const upgraded = mats.map(toStandardMaterial);
      mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0];
    });
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene, isRigged(scene));
    return { scene, animations, bounds };
  }
}

/** Finds a file in an asset by exact path, case-insensitive path, then bare file name. */
export function findFileUrl(asset: ResolvedAsset, rawPath: string): string | undefined {
  const path = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const direct = asset.url(path);
  if (direct) return direct;
  const lower = path.toLowerCase();
  const name = lower.split('/').pop() ?? lower;
  const files = asset.files;
  const match =
    files.find((f) => f.toLowerCase() === lower) ?? files.find((f) => f.toLowerCase().split('/').pop() === name);
  return match ? asset.url(match) : undefined;
}

function toStandardMaterial(m: THREE.Material): THREE.Material {
  if (m instanceof THREE.MeshStandardMaterial || !(m instanceof THREE.MeshPhongMaterial || m instanceof THREE.MeshLambertMaterial)) {
    return m;
  }
  const s = new THREE.MeshStandardMaterial({
    name: m.name,
    color: m.color,
    map: m.map,
    normalMap: 'normalMap' in m ? (m.normalMap as THREE.Texture | null) : null,
    emissive: m.emissive,
    emissiveMap: m.emissiveMap,
    alphaMap: m.alphaMap,
    aoMap: m.aoMap,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    vertexColors: m.vertexColors,
    roughness: m instanceof THREE.MeshPhongMaterial ? 1 - Math.min(m.shininess / 100, 0.9) : 1,
    metalness: 0,
  });
  m.dispose();
  return s;
}

/** Rigged models are measured as their skeleton draws them (their raw mesh can sit elsewhere). */
export function isRigged(o: THREE.Object3D): boolean {
  let rigged = false;
  o.traverse((c) => (rigged ||= (c as THREE.SkinnedMesh).isSkinnedMesh === true));
  return rigged;
}
