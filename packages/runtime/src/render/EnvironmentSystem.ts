import * as THREE from 'three';
import { SkyDome, type SkyLook } from './SkyDome';
import type { AssetManager } from '../assets/AssetManager';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { Light } from '../components/builtin';
import {
  DayNightCycle,
  Fog,
  PostProcessing,
  SKY_DEFAULT_COLORS,
  Sky,
  skyTimesAt,
  sunFromHour,
  type FogData,
  type PostProcessingData,
  type SkyData,
  type SkyTime,
} from '../components/environment';
import type { SceneSettings } from '../scene/SceneData';
import type { RenderSystem } from './RenderSystem';

/** How far around the camera sun shadows reach (meters, each side). */
const SHADOW_RANGE = 45;
/** Regenerate sky lighting at most this often while the sky changes (seconds). */
const ENV_REFRESH = 0.35;

const DAY_SUN = new THREE.Color('#fff3e2');
const LOW_SUN = new THREE.Color('#ffae66');
const MOON = new THREE.Color('#9fb3ff');
const DAY_HORIZON = new THREE.Color('#c9d9e8');
const DUSK_HORIZON = new THREE.Color('#e7b28a');
const NIGHT_HORIZON = new THREE.Color('#121823');

export interface EnvironmentOptions {
  renderer: THREE.WebGLRenderer | null;
  /** Loads skybox images (optional: without it skies use their colors). */
  assets?: AssetManager | null;
  camera: () => THREE.Camera;
  settings: () => SceneSettings;
}

/**
 * Optional environment components: Sky (with a fixed or cycling time of day), Fog and Post
 * Processing settings. Also keeps directional-light shadows centred on the camera so big
 * outdoor scenes have shadows everywhere you look. With none of these components the scene
 * looks exactly as before.
 */
export class EnvironmentSystem implements System {
  readonly name = 'environment';
  readonly order = 1090;
  playing = false;
  /** Editor: hide fog in the editor's view (not in the game camera). */
  hideFog = false;
  private world: World | null = null;
  private readonly scene: THREE.Scene;
  private readonly render: RenderSystem;
  private readonly options: EnvironmentOptions;
  private sky: SkyDome | null = null;
  private envSky: SkyDome | null = null;
  /** Skybox images by asset id (null while loading or if it failed). */
  private readonly skyboxes = new Map<string, THREE.Texture | null>();
  /** Horizon color of the sky being shown (fog can match it). */
  private readonly horizon = new THREE.Color();
  private skyTime = 0;
  private envScene: THREE.Scene | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envKey = '';
  private envAge = Infinity;
  private skyActive = false;
  private fogActive = false;
  /** Running time of day per Sky entity (never written back to the scene). */
  private readonly hours = new Map<string, number>();

  constructor(scene: THREE.Scene, render: RenderSystem, options: EnvironmentOptions) {
    this.scene = scene;
    this.render = render;
    this.options = options;
  }

  attach(world: World): void {
    this.world = world;
  }

  detach(): void {
    this.removeSky();
    this.world = null;
  }

  /** Reset cycling time (Play starts/stops: the saved hour is used again). */
  resetTime(): void {
    this.hours.clear();
  }

  /** Current time of day of the scene's Sky, or null without one. */
  get hour(): number | null {
    const e = this.first(Sky);
    return e ? this.hourOf(e, e.require(Sky)) : null;
  }

  /** The active Post Processing settings, if any. */
  postProcessing(): PostProcessingData | null {
    const e = this.first(PostProcessing);
    return e ? e.require(PostProcessing) : null;
  }

  update(dt: number): void {
    const w = this.world;
    if (!w) return;
    // Day/Night Cycle: move the time forward (in memory only).
    const cycle = this.first(DayNightCycle);
    const skyEntity = this.first(Sky);
    if (cycle && skyEntity && dt > 0) {
      const c = cycle.require(DayNightCycle);
      if (this.playing || c.previewInEditor) {
        const h = this.hourOf(skyEntity, skyEntity.require(Sky));
        this.hours.set(skyEntity.id, (h + (24 * dt) / Math.max(0.1, c.minutesPerDay * 60)) % 24);
      }
    }
    this.envAge += dt;
    this.skyTime += dt;
  }

  lateUpdate(): void {
    if (!this.world) return;
    const skyEntity = this.first(Sky);
    const sky = skyEntity?.require(Sky) ?? null;
    const sun = sky ? sunFromHour({ ...sky, hour: this.hourOf(skyEntity!, sky) }) : null;

    if (sky && sun) this.applySky(sky, sun);
    else if (this.skyActive) this.removeSky();

    this.applyFog(this.first(Fog)?.require(Fog) ?? null, sun?.elevation ?? null);
    this.applyLights(sky, sun);
  }

  // ── sky ───────────────────────────────────────────────────────────────────

  /** Built-in colors or a skybox image for one time of day. */
  private look(sky: SkyData, t: SkyTime): SkyLook {
    const colors = sky.customColors ? sky : SKY_DEFAULT_COLORS;
    const id = sky[`${t}Skybox`];
    return {
      zenith: new THREE.Color(colors[`${t}Top`]),
      horizon: new THREE.Color(colors[`${t}Horizon`]),
      ground: new THREE.Color(sky.groundColor),
      texture: id ? this.skybox(id) : null,
    };
  }

  private skybox(id: string): THREE.Texture | null {
    if (this.skyboxes.has(id)) return this.skyboxes.get(id)!;
    this.skyboxes.set(id, null);
    this.options.assets
      ?.loadEnvironment(id)
      .then((tex) => {
        this.skyboxes.set(id, tex);
        this.envKey = ''; // relight with the image
      })
      .catch((err: unknown) => console.error('[EGE] Skybox failed to load:', err instanceof Error ? err.message : err));
    return null;
  }

  private applySky(sky: SkyData, sun: { dir: [number, number, number]; elevation: number }): void {
    if (!this.sky) {
      this.sky = new SkyDome();
      this.sky.userData.editorOnly = true;
      this.sky.name = 'EGE:Sky';
      this.scene.add(this.sky);
    }
    this.skyActive = true;
    // A dome around the camera, inside its view distance.
    const cam = this.options.camera() as THREE.PerspectiveCamera;
    cam.updateWorldMatrix(true, false);
    this.sky.position.setFromMatrixPosition(cam.matrixWorld);
    this.sky.scale.setScalar((cam.far ?? 2000) * 0.9);

    const times = skyTimesAt(this.hourOfSky(sky));
    const night = (t: SkyTime) => (t === 'night' ? 1 : 0);
    const nightness = night(times.a) * (1 - times.blend) + night(times.b) * times.blend;
    const a = this.look(sky, times.a);
    const b = this.look(sky, times.b);
    this.horizon.copy(a.horizon).lerp(b.horizon, times.blend);
    const sunColor = LOW_SUN.clone().lerp(DAY_SUN, Math.min(1, Math.max(0, sun.elevation / 25)));
    const frame = {
      a,
      b,
      blend: times.blend,
      sunDir: new THREE.Vector3(...sun.dir),
      sunColor,
      sunStrength: THREE.MathUtils.smoothstep(sun.elevation, -3, 2),
      sunSize: sky.sunSize,
      stars: sky.stars ? nightness : 0,
      moon: sky.moon ? nightness : 0,
      clouds: sky.clouds,
      cloudSpeed: sky.cloudSpeed,
      skyboxBrightness: sky.skyboxBrightness,
      time: this.skyTime,
    };
    this.sky.update(frame);
    this.scene.background = null; // the dome is the background

    // Image-based lighting from the sky, refreshed when it changes (throttled).
    const key = [times.a, times.b, times.blend.toFixed(2), sun.dir.map((v) => v.toFixed(2)).join(','), sky.clouds.toFixed(2), a.texture?.uuid, b.texture?.uuid, sky.skyboxBrightness, sky.customColors && JSON.stringify([sky.dayTop, sky.dayHorizon, sky.sunsetTop, sky.sunsetHorizon, sky.nightTop, sky.nightHorizon, sky.dawnTop, sky.dawnHorizon])].join('|');
    if (sky.skyLighting && this.options.renderer) {
      if (key !== this.envKey && this.envAge >= ENV_REFRESH) {
        this.envKey = key;
        this.envAge = 0;
        this.pmrem ??= new THREE.PMREMGenerator(this.options.renderer);
        this.envScene ??= new THREE.Scene();
        if (!this.envSky) {
          this.envSky = new SkyDome();
          this.envSky.scale.setScalar(100);
          this.envScene.add(this.envSky);
        }
        this.envSky.update({ ...frame, stars: 0 }, false); // no sun disc / stars: they'd sparkle in reflections
        const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
        this.envTarget?.dispose();
        this.envTarget = next;
      }
      this.scene.environment = this.envTarget?.texture ?? null;
      this.scene.environmentIntensity = sky.skyLightIntensity;
    } else if (!sky.skyLighting) {
      this.scene.environment = null;
    }
  }

  private removeSky(): void {
    if (!this.skyActive && !this.sky) return;
    this.sky?.removeFromParent();
    this.sky?.dispose();
    this.sky = null;
    this.envTarget?.dispose();
    this.envTarget = null;
    this.envKey = '';
    this.skyActive = false;
    this.render.applySettings(this.options.settings()); // background / HDRI back as they were
  }

  // ── fog ───────────────────────────────────────────────────────────────────

  private applyFog(fog: FogData | null, sunElevation: number | null): void {
    if (this.hideFog && !this.playing) {
      this.scene.fog = null;
      this.fogActive = true; // restore properly when turned back on
      return;
    }
    if (!fog) {
      if (this.fogActive) {
        this.fogActive = false;
        const f = this.options.settings().fog; // legacy scene fog (off by default)
        this.scene.fog = f.enabled ? new THREE.Fog(f.color, f.near, f.far) : null;
      }
      return;
    }
    this.fogActive = true;
    const color = fog.matchSky && sunElevation !== null ? this.horizon.clone() : new THREE.Color(fog.color);
    // Height fog: the higher the camera is above the fog's ground level, the further it sees.
    const cam = this.options.camera();
    cam.updateWorldMatrix(true, false);
    const above = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).y - (fog.groundLevel ?? 0);
    const thin = (fog.thinsOut ?? 0) > 0 ? 1 + Math.max(0, above) / fog.thinsOut : 1;
    if (fog.mode === 'exponential') {
      if (!(this.scene.fog instanceof THREE.FogExp2)) this.scene.fog = new THREE.FogExp2(color, fog.density);
      const f = this.scene.fog as THREE.FogExp2;
      f.color.copy(color);
      f.density = fog.density / thin;
    } else {
      if (!(this.scene.fog instanceof THREE.Fog)) this.scene.fog = new THREE.Fog(color, fog.start, fog.end);
      const f = this.scene.fog as THREE.Fog;
      f.color.copy(color);
      f.near = fog.start * thin;
      f.far = Math.max(fog.start + 1, fog.end) * thin;
    }
  }

  // ── sun & shadows ─────────────────────────────────────────────────────────

  private applyLights(sky: SkyData | null, sun: { dir: [number, number, number]; elevation: number } | null): void {
    const w = this.world!;
    const cam = this.options.camera();
    cam.updateWorldMatrix(true, false);
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) forward.normalize();
    const focus = camPos.clone().addScaledVector(forward, SHADOW_RANGE * 0.4);
    focus.y = Math.min(focus.y, camPos.y);

    let driven = false;
    // Ambient / hemisphere lights fade with the daylight too, or nights glow.
    const daylight = sky?.driveSunLight && sun ? THREE.MathUtils.smoothstep(sun.elevation, -6, 10) : 1;
    for (const e of w.query(Light)) {
      const data = e.require(Light);
      if (!e.activeInHierarchy || (data.kind !== 'hemisphere' && data.kind !== 'ambient')) continue;
      const amb = this.render.nodeOf(e)?.children.find((o): o is THREE.Light => (o as THREE.Light).isLight);
      if (amb) amb.intensity = data.intensity * (0.12 + 0.88 * daylight);
    }
    for (const e of w.query(Light)) {
      const data = e.require(Light);
      if (data.kind !== 'directional' || !e.activeInHierarchy) continue;
      const node = this.render.nodeOf(e);
      const light = node?.children.find((o): o is THREE.DirectionalLight => (o as THREE.DirectionalLight).isDirectionalLight);
      if (!node || !light) continue;
      node.updateWorldMatrix(true, false);

      // Direction toward the light: from the sky, or from how the entity is rotated.
      const toLight = new THREE.Vector3();
      if (sky?.driveSunLight && sun && !driven) {
        driven = true;
        toLight.set(...sun.dir);
        if (sun.elevation > 0) {
          const strength = Math.min(1, Math.sin((sun.elevation * Math.PI) / 180) * 1.8);
          light.intensity = data.intensity * strength;
          light.color.copy(LOW_SUN).lerp(DAY_SUN, Math.min(1, sun.elevation / 25));
        } else {
          // Night: the same light becomes faint moonlight from the other side.
          toLight.set(-sun.dir[0], Math.max(0.3, -sun.dir[1]), -sun.dir[2]).normalize();
          light.intensity = data.intensity * 0.06;
          light.color.copy(MOON);
        }
      } else {
        toLight.set(0, 0, 1).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion())).normalize();
        light.intensity = data.intensity;
        light.color.set(data.color);
      }

      // Keep the shadow box around what the camera sees instead of around the world origin, moved
      // in whole shadow-map pixels only: otherwise every step slides the shadows by part of a pixel
      // and they shimmer and crawl as you walk.
      const center = light.castShadow ? snapToShadowTexels(focus, toLight, (2 * SHADOW_RANGE) / Math.max(1, light.shadow.mapSize.x)) : focus;
      const lightWorld = center.clone().addScaledVector(toLight, 120);
      light.position.copy(node.worldToLocal(lightWorld.clone()));
      light.target.position.copy(node.worldToLocal(center.clone()));
      if (light.castShadow) {
        const sc = light.shadow.camera;
        sc.left = sc.bottom = -SHADOW_RANGE;
        sc.right = sc.top = SHADOW_RANGE;
        sc.near = 1;
        sc.far = 300;
        sc.updateProjectionMatrix();
      }
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private hourOf(e: Entity, sky: SkyData): number {
    return this.hours.get(e.id) ?? sky.hour;
  }

  private hourOfSky(sky: SkyData): number {
    const e = this.first(Sky);
    return e ? this.hourOf(e, sky) : sky.hour;
  }

  private first(def: Parameters<Entity['has']>[0]): Entity | undefined {
    for (const e of this.world?.query(def) ?? []) if (e.activeInHierarchy) return e;
    return undefined;
  }
}

/** Color of the horizon for a sun elevation (fog that blends into the sky). */
export function horizonColor(elevation: number): THREE.Color {
  if (elevation >= 12) return DAY_HORIZON.clone();
  if (elevation >= 0) return DUSK_HORIZON.clone().lerp(DAY_HORIZON, elevation / 12);
  return NIGHT_HORIZON.clone().lerp(DUSK_HORIZON, Math.max(0, 1 + elevation / 8));
}

/** A point moved to the nearest whole shadow-map pixel, as seen from the light. */
export function snapToShadowTexels(point: THREE.Vector3, toLight: THREE.Vector3, texel: number): THREE.Vector3 {
  const dir = toLight.clone().normalize();
  const helper = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(helper, dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right);
  const r = point.dot(right);
  const u = point.dot(up);
  return point
    .clone()
    .addScaledVector(right, Math.round(r / texel) * texel - r)
    .addScaledVector(up, Math.round(u / texel) * texel - u);
}
