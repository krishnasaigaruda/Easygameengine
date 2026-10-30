import * as THREE from 'three';
import type { AssetManager } from '../assets/AssetManager';
import { asFoliage } from './foliageMaterial';
import { mergeByMaterial } from './ScatterSystem';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { Grass, type GrassData } from '../components/foliage';
import { Terrain } from '../components/terrain';
import type { RenderSystem } from './RenderSystem';
import type { TerrainSystem } from './TerrainSystem';
import { shaderTime } from './shaders';
import { decodePaint, pointsPerSide } from '../terrain/heightmap';

/** Most tufts drawn per Grass component (keeps phones and laptops happy). */
const MAX_TUFTS = 50_000;
/** Blades per tuft: one instance draws a little clump, like grass really grows. */
const TUFT = 5;
const SEGMENTS = 3;

/**
 * One tuft: TUFT thin, tapered blades from 0 (root) to 1 (tip). Each blade carries its own
 * offset, turn, height and lean (aBlade), so a clump never looks like copies of one blade.
 */
function bladeGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos: number[] = [];
  const blade: number[] = [];
  const idx: number[] = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let b = 0; b < TUFT; b++) {
    const r = Math.sqrt(rnd()) * 0.09;
    const a = rnd() * Math.PI * 2;
    const info = [Math.cos(a) * r, Math.sin(a) * r, rnd() * Math.PI * 2, 0.55 + rnd() * 0.6];
    const base = pos.length / 3;
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const w = Math.pow(1 - t, 0.8) * 0.5 + 0.02;
      pos.push(-w, t, 0, w, t, 0);
      blade.push(...info, ...info);
      if (i < SEGMENTS) {
        const k = base + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 4));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

/** Triangles all grass-model clumps may draw together (they're denser than blades). */
const MODEL_TRIANGLE_BUDGET = 2_000_000;

/** A grass model ready to grow: one geometry, 1 m tall, standing on y = 0, centred. */
interface GrassModel {
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.MeshStandardMaterial;
  triangles: number;
}

interface GrassVisual {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  /** '' = built-in blades. */
  modelId: string;
  triangles: number;
  uniforms: Record<string, THREE.IUniform>;
  side: number;
  /** Painted grass: how much grows where (one byte per terrain grid point). */
  paint: Uint8Array | null;
  paintTex: THREE.DataTexture | null;
  paintText: string;
}

const FLAT = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
FLAT.needsUpdate = true;
const ALL_BASE = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1);
ALL_BASE.needsUpdate = true;

export interface GrassOptions {
  camera: () => THREE.Camera;
  /** For grass models. */
  assets?: AssetManager;
  /** Quality: multiplies density and distance. */
  amount?: () => number;
}

/**
 * Grass, drawn in one go on the GPU: every blade's spot comes from a grid that follows the
 * camera (snapped, so blades don't swim), the terrain heightmap gives the ground height and the
 * paint map says where grass may grow.
 */
export class GrassSystem implements System {
  readonly name = 'grass';
  readonly order = 1020;
  private world: World | null = null;
  private readonly visuals = new Map<string, GrassVisual>();
  private unsubscribers: (() => void)[] = [];
  private readonly models = new Map<string, Promise<GrassModel | null>>();

  constructor(
    private readonly render: RenderSystem,
    private readonly terrain: TerrainSystem,
    private readonly options: GrassOptions,
  ) {}

  attach(world: World): void {
    this.world = world;
    const ev = world.events;
    const sync = ({ entity, type }: { entity: Entity; type: string }) => (type === Grass.type || type === Terrain.type) && this.sync(entity);
    this.unsubscribers = [
      ev.on('componentAdded', sync),
      ev.on('componentChanged', sync),
      ev.on('componentRemoved', sync),
      ev.on('entityDestroyed', ({ entity }) => this.remove(entity.id)),
    ];
    for (const e of world.all()) this.sync(e);
  }

  /** Quality changed: rebuild with the new blade amount. */
  refresh(): void {
    for (const e of this.world?.all() ?? []) if (e.has(Grass)) this.sync(e);
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    for (const id of [...this.visuals.keys()]) this.remove(id);
    this.world = null;
  }

  /** Live paint map for the Grass brush (null if this grass isn't painted or has no terrain). */
  paintData(entityId: string): { map: Uint8Array; resolution: number; changed: () => void } | null {
    const v = this.visuals.get(entityId);
    const e = this.world?.getById(entityId);
    const t = e?.get(Terrain);
    if (!v || !t) return null;
    const res = Math.round(t.resolution);
    this.ensurePaint(v, e!.get(Grass)!.paintMap, res);
    return { map: v.paint!, resolution: res, changed: () => v.paintTex && (v.paintTex.needsUpdate = true) };
  }

  private ensurePaint(v: GrassVisual, text: string, res: number): void {
    const n = pointsPerSide(res);
    if (!v.paint || v.paint.length !== n * n) {
      v.paint = decodePaint(text, res);
      v.paintText = text;
      v.paintTex?.dispose();
      v.paintTex = new THREE.DataTexture(v.paint, n, n, THREE.RedFormat, THREE.UnsignedByteType);
      v.paintTex.magFilter = v.paintTex.minFilter = THREE.LinearFilter;
      v.paintTex.needsUpdate = true;
    } else if (text !== v.paintText) {
      v.paint.set(decodePaint(text, res));
      v.paintText = text;
      v.paintTex!.needsUpdate = true;
    }
  }

  /** Blades drawn for an entity (tests). */
  bladeCount(entityId: string): number {
    return this.visuals.get(entityId)?.mesh.geometry.instanceCount ?? 0;
  }

  lateUpdate(): void {
    const w = this.world;
    if (!w) return;
    const cam = this.options.camera();
    cam.updateWorldMatrix(true, false);
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    for (const [id, v] of this.visuals) {
      const e = w.getById(id);
      const g = e?.get(Grass);
      if (!e || !g) continue;
      v.mesh.visible = e.activeInHierarchy;
      const node = this.render.nodeOf(e);
      if (!node) continue;
      node.updateWorldMatrix(true, false);
      const u = v.uniforms;
      const origin = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
      const scale = new THREE.Vector3().setFromMatrixScale(node.matrixWorld);
      (u.uOrigin.value as THREE.Vector3).copy(origin);
      const t = e.get(Terrain);
      u.uPainted.value = g.painted && t ? 1 : 0;
      if (g.painted && t) {
        this.ensurePaint(v, g.paintMap, Math.round(t.resolution));
        u.uPaint.value = v.paintTex;
      }
      if (t) {
        const tex = this.terrain.textures(id);
        u.uHeights.value = tex?.heights ?? FLAT;
        u.uSplat.value = tex?.splat ?? ALL_BASE;
        u.uSize.value.set(t.size * scale.x, t.size * scale.z);
        u.uMaxHeight.value = t.maxHeight * scale.y;
        u.uTexel.value = 1 / (tex?.resolution ?? 1);
        u.uRes.value = (tex?.resolution ?? 0) + 1;
        u.uSnowLine.value = t.autoPaint ? t.snowLine : 9;
      } else {
        u.uHeights.value = FLAT;
        u.uSplat.value = ALL_BASE;
        u.uSize.value.set(Math.max(0.1, scale.x), Math.max(0.1, scale.z));
        u.uMaxHeight.value = 0;
        u.uSnowLine.value = 9;
        u.uRes.value = 1;
      }
      // Snap the grid to whole cells so blades stay put as the camera moves.
      const cell = u.uCell.value as number;
      (u.uCamera.value as THREE.Vector2).set(Math.round(camPos.x / cell) * cell, Math.round(camPos.z / cell) * cell);
      (u.uCameraPos.value as THREE.Vector3).copy(camPos);
      u.uWind.value = g.wind;
      u.uWindSpeed.value = g.windSpeed;
    }
  }

  private sync(e: Entity): void {
    const g = e.get(Grass);
    if (!g) return this.remove(e.id);
    const node = this.render.nodeOf(e);
    if (!node) return;
    const modelId = g.model && this.options.assets ? g.model : '';
    let v = this.visuals.get(e.id);
    if (!v || v.modelId !== modelId || v.mesh.parent !== this.render.root.parent) {
      this.remove(e.id);
      if (modelId) {
        // Load the model, then grow it (until then: nothing, not the blades).
        void this.loadModel(modelId).then((m) => {
          const cur = e.get(Grass);
          if (!m || !cur || cur.model !== modelId || this.visuals.has(e.id) || !this.world) return;
          const built = this.build(m);
          built.modelId = modelId;
          this.visuals.set(e.id, built);
          (this.render.root.parent ?? this.render.root).add(built.mesh);
          this.sync(e);
        });
        return;
      }
      v = this.build();
      this.visuals.set(e.id, v);
      (this.render.root.parent ?? this.render.root).add(v.mesh);
    }
    const amount = this.options.amount?.() ?? 1;
    const distance = g.distance * Math.sqrt(amount);
    // Blades: density is blades per m², each instance a tuft of TUFT. Models: clumps per m².
    let density = modelId ? g.clumps * amount : (g.density * amount) / TUFT;
    // Keep within the budget by thinning, not by shrinking the draw distance.
    const area = (2 * distance) ** 2;
    const most = modelId ? Math.min(MAX_TUFTS, Math.floor(MODEL_TRIANGLE_BUDGET / Math.max(1, v.triangles))) : MAX_TUFTS;
    if (area * density > most) density = most / area;
    const cell = 1 / Math.sqrt(Math.max(0.01, density));
    const side = Math.max(1, Math.ceil((2 * distance) / cell));
    v.side = side;
    v.mesh.geometry.instanceCount = side * side;
    const u = v.uniforms;
    u.uCell.value = cell;
    u.uSide.value = side;
    u.uDistance.value = distance;
    u.uHeight.value = modelId ? g.clumpHeight : g.height;
    u.uWidth.value = g.width;
    (u.uRoot.value as THREE.Color).set(g.rootColor);
    (u.uTip.value as THREE.Color).set(g.tipColor);
    u.uLayer.value = Math.round(g.onLayer);
    u.uMaxSlope.value = g.maxSlope;
  }

  /** A grass model as one 1 m tall clump (the foliage look: cut-out, matte, never metal). */
  private loadModel(id: string): Promise<GrassModel | null> {
    let p = this.models.get(id);
    if (!p) {
      p = this.options
        .assets!.instantiate(id)
        .then(({ object }) => {
          object.updateMatrixWorld(true);
          const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }[] = [];
          object.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh && !Array.isArray(m.material)) parts.push({ geometry: m.geometry, material: asFoliage(m.material), local: m.matrixWorld.clone() });
          });
          // One draw: the material covering the most of the model.
          const merged = mergeByMaterial(parts).parts.sort((a, b) => triangles(b.geometry) - triangles(a.geometry))[0];
          if (!merged) return null;
          const geo = merged.geometry.clone().applyMatrix4(merged.local);
          geo.computeBoundingBox();
          const box = geo.boundingBox!;
          const h = Math.max(1e-6, box.max.y - box.min.y);
          const c = box.getCenter(new THREE.Vector3());
          geo.translate(-c.x, -box.min.y, -c.z).scale(1 / h, 1 / h, 1 / h);
          const inst = new THREE.InstancedBufferGeometry();
          for (const [name, attr] of Object.entries(geo.attributes)) inst.setAttribute(name, attr);
          if (geo.index) inst.setIndex(geo.index);
          // The blades' per-blade data, neutral for a model (no offset, no turn, full height).
          const n = geo.getAttribute('position').count;
          inst.setAttribute('aBlade', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 3 ? 1 : 0)), 4));
          return { geometry: inst, material: merged.material as THREE.MeshStandardMaterial, triangles: triangles(geo) };
        })
        .catch((err: unknown) => {
          console.error('[EGE] Grass model failed to load:', err instanceof Error ? err.message : err);
          return null;
        });
      this.models.set(id, p);
    }
    return p;
  }

  private build(model?: GrassModel): GrassVisual {
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: shaderTime,
      uHeights: { value: FLAT },
      uSplat: { value: ALL_BASE },
      uPaint: { value: ALL_BASE },
      uPainted: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uSize: { value: new THREE.Vector2(1, 1) },
      uMaxHeight: { value: 0 },
      uTexel: { value: 1 },
      uRes: { value: 1 },
      uSnowLine: { value: 9 },
      uCamera: { value: new THREE.Vector2() },
      uCameraPos: { value: new THREE.Vector3() },
      uCell: { value: 0.2 },
      uSide: { value: 1 },
      uDistance: { value: 40 },
      uHeight: { value: 0.45 },
      uWidth: { value: 0.06 },
      uRoot: { value: new THREE.Color() },
      uTip: { value: new THREE.Color() },
      uLayer: { value: 1 },
      uMaxSlope: { value: 35 },
      uWind: { value: 0.5 },
      uWindSpeed: { value: 1 },
    };
    const mat = model ? model.material.clone() : new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    if (model) {
      mat.defines = { ...mat.defines, EGE_GRASS_MODEL: '' };
      mat.normalMap = null; // its normals turn with each clump; a tangent map wouldn't
    }
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform sampler2D uHeights, uSplat, uPaint;
          uniform float uPainted;
          uniform vec3 uOrigin, uCameraPos, uRoot, uTip;
          uniform vec2 uSize, uCamera;
          uniform float uTime, uMaxHeight, uTexel, uSnowLine, uCell, uSide, uDistance, uHeight, uWidth, uLayer, uMaxSlope, uWind, uWindSpeed;
          varying vec3 vGrassColor;
          attribute vec4 aBlade;
          float gHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          // Smooth value noise for big patches (clumps, dry spots).
          float gNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
          }
          uniform float uRes;
          // Bilinear by hand (works on every GPU, unlike filtered float textures).
          float gH(ivec2 p) { return texelFetch(uHeights, clamp(p, ivec2(0), ivec2(int(uRes) - 1)), 0).r; }
          float gHeight(vec2 uv) {
            vec2 p = clamp(uv, 0.0, 1.0) * (uRes - 1.0);
            ivec2 i = ivec2(floor(p));
            vec2 f = p - floor(p);
            float a = mix(gH(i), gH(i + ivec2(1, 0)), f.x);
            float b = mix(gH(i + ivec2(0, 1)), gH(i + ivec2(1, 1)), f.x);
            return mix(a, b, f.y) * uMaxHeight;
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          float id = float(gl_InstanceID);
          vec2 cellIdx = vec2(mod(id, uSide), floor(id / uSide)) - uSide * 0.5;
          vec2 world = uCamera + cellIdx * uCell;
          vec2 cellKey = floor(world / uCell + 0.5);
          float r1 = gHash(cellKey), r2 = gHash(cellKey + 17.3), r3 = gHash(cellKey + 41.7);
          world += (vec2(r1, r2) - 0.5) * uCell;
          vec2 local = world - uOrigin.xz;
          vec2 uv = local / uSize + 0.5;
          float keep = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          // Height (and slope) from the heightmap. Rows go along +Z (row 0 at the -Z edge).
          vec2 huv = vec2(uv.x, uv.y);
          float ground = gHeight(huv);
          float hx = gHeight(huv + vec2(uTexel, 0.0)) - gHeight(huv - vec2(uTexel, 0.0));
          float hz = gHeight(huv + vec2(0.0, uTexel)) - gHeight(huv - vec2(0.0, uTexel));
          float step2 = 2.0 * uTexel * uSize.x;
          vec3 gnorm = normalize(vec3(-hx, step2, -hz));
          float slope = degrees(acos(clamp(gnorm.y, 0.0, 1.0)));
          keep *= step(slope, uMaxSlope);
          if (uMaxHeight > 0.0) keep *= step(ground / uMaxHeight, uSnowLine - 0.03);
          // Paint: only where the chosen layer is painted.
          vec4 paint = texture2D(uSplat, huv);
          float layerW = uLayer < 0.5 ? 1.0 : uLayer < 1.5 ? paint.r : uLayer < 2.5 ? paint.g : uLayer < 3.5 ? paint.b : paint.a;
          // Painted grass grows only where painted (and thinner where painted lightly).
          float painted = texture2D(uPaint, huv).r;
          layerW = uPainted > 0.5 ? painted : layerW;
          keep *= step(0.5, layerW + (r3 - 0.5) * (uPainted > 0.5 ? 0.9 : 0.3));
          // Fade out toward the edge of the draw distance: thinning (each tuft leaves at its own
          // distance) more than shrinking, over a long band, so no edge line follows the camera.
          float dist = distance(vec3(world.x, uOrigin.y + ground, world.y), uCameraPos);
          // Each tuft shrinks away smoothly near its own distance (no pops, no single moving line).
          float edge = smoothstep(uDistance * 0.45, uDistance, dist);
          float own = 0.3 + r2 * 0.7;
          float fade = 1.0 - smoothstep(own - 0.2, own, edge);
          // Clumps: some patches grow taller, some stay short.
          float clump = gNoise(world * 0.35);
          float h = uHeight * (0.45 + r3 * 0.55) * (0.6 + clump * 0.9) * fade * keep * aBlade.w;
          float angle = r1 * 6.2831 + aBlade.z;
          float t = position.y;
          // Blades in a tuft lean outward from its middle, each a bit differently.
          float lean = 0.25 + fract(aBlade.z * 3.7) * 0.5;
          // Wind: a gentle sway plus gusts rolling across the field.
          float gust = sin(world.x * 0.15 + uTime * uWindSpeed * 1.3) * 0.5 + sin(world.y * 0.11 + uTime * uWindSpeed * 0.9) * 0.5;
          float bend = (0.25 + gust * 0.5 + sin(uTime * uWindSpeed * 2.7 + r2 * 6.28) * 0.15) * uWind * t * t;
          #ifdef EGE_GRASS_MODEL
            // A grass model: 1 m tall, scaled to this clump's height, swaying at the top.
            vec3 transformed = position * h;
            transformed.z += bend * h;
          #else
            vec3 transformed = vec3(position.x * uWidth * (0.7 + r2 * 0.6), t * h, 0.0);
            transformed.z += (bend + lean * t * t) * h;
          #endif
          float ca = cos(angle), sa = sin(angle);
          transformed = vec3(transformed.x * ca - transformed.z * sa, transformed.y, transformed.x * sa + transformed.z * ca);
          // Place the blade in its tuft (the tuft turned as a whole by r1).
          float ta = r1 * 6.2831, tc = cos(ta), ts = sin(ta);
          transformed.xz += vec2(aBlade.x * tc - aBlade.y * ts, aBlade.x * ts + aBlade.y * tc) * (0.6 + uHeight);
          transformed += vec3(world.x, uOrigin.y + ground, world.y);
          // Color: root to tip, lush and dry patches, a little variety per blade, darker at the root.
          float dry = smoothstep(0.55, 0.85, gNoise(world * 0.06 + 13.0));
          vec3 tip = mix(uTip, uTip * vec3(1.25, 1.1, 0.62), dry);
          // Each blade its own shade: some greener, some yellower, some darker.
          float bv = fract(aBlade.z * 7.13);
          tip = mix(tip, tip * vec3(1.08, 1.04, 0.7), step(0.8, bv));
          #ifdef EGE_GRASS_MODEL
            // The model's own colors, with lush and dry patches and a darker base.
            vGrassColor = mix(vec3(1.0), vec3(1.15, 1.05, 0.7), dry * 0.6) * (0.82 + r2 * 0.3) * (0.65 + 0.35 * clamp(t, 0.0, 1.0));
          #else
            vGrassColor = mix(uRoot, tip, pow(t, 0.8)) * (0.78 + r2 * 0.3 + bv * 0.16) * (0.5 + 0.5 * t);
          #endif
          `,
        )
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `
          #ifdef EGE_GRASS_MODEL
            // Turn the model's normals with its clump (same turn as below), softened toward up.
            float nid = float(gl_InstanceID);
            vec2 nWorld = uCamera + (vec2(mod(nid, uSide), floor(nid / uSide)) - uSide * 0.5) * uCell;
            float nAngle = gHash(floor(nWorld / uCell + 0.5)) * 6.2831;
            float nc = cos(nAngle), ns = sin(nAngle);
            vec3 objectNormal = normalize(mix(vec3(normal.x * nc - normal.z * ns, normal.y, normal.x * ns + normal.z * nc), vec3(0.0, 1.0, 0.0), 0.5));
          #else
            vec3 objectNormal = vec3(0.0, 1.0, 0.0);
          #endif`,
        )
        .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);\ngl_Position = projectionMatrix * mvPosition;')
        .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassColor;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n#ifdef EGE_GRASS_MODEL\ndiffuseColor.rgb *= vGrassColor;\n#else\ndiffuseColor.rgb = vGrassColor;\n#endif',
        )
        // Both sides of a blade light the same (three would flip the back's normal: black blades).
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    mat.customProgramCacheKey = () => (model ? 'ege-grass-model' : 'ege-grass');
    const geometry = model ? (model.geometry.clone() as THREE.InstancedBufferGeometry) : bladeGeometry();
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.name = 'EGE:Grass';
    mesh.userData.editorOnly = true; // not pickable / not a collider
    return { mesh, modelId: '', triangles: model ? model.triangles : TUFT * SEGMENTS * 2, uniforms, side: 1, paint: null, paintTex: null, paintText: '' };
  }

  private remove(id: string): void {
    const v = this.visuals.get(id);
    if (!v) return;
    v.mesh.removeFromParent();
    v.mesh.geometry.dispose();
    v.mesh.material.dispose();
    v.paintTex?.dispose();
    this.visuals.delete(id);
  }
}

export type { GrassData };

function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}
