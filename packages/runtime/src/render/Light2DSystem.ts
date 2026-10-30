import * as THREE from 'three';
import type { System, World } from '../core/World';
import { Light2D } from '../components/light2d';
import type { RenderSystem } from './RenderSystem';
import { MAX_LIGHTS_2D, light2DUniforms } from './light2d';

/** Fills the 2D light uniforms: the lights nearest the camera, flickering ones flickering. */
export class Light2DSystem implements System {
  readonly name = 'lights2d';
  readonly order = 950;
  private world: World | null = null;
  private time = 0;

  constructor(
    private readonly render: RenderSystem,
    /** How dark the 2D scene is where no light reaches (0 = daylight, 1 = black). */
    private readonly darkness: () => number,
    private readonly camera: () => THREE.Camera,
  ) {}

  attach(world: World): void {
    this.world = world;
  }

  detach(): void {
    this.world = null;
    light2DUniforms.uLight2DOn.value = 0;
    light2DUniforms.uLight2DCount.value = 0;
  }

  lateUpdate(dt: number): void {
    const u = light2DUniforms;
    if (!this.world) return;
    this.time += dt;
    const dark = Math.min(1, Math.max(0, this.darkness()));
    const cam = new THREE.Vector3().setFromMatrixPosition(this.camera().matrixWorld);
    const lights: { pos: THREE.Vector3; d: ReturnType<typeof Light2D.defaults>; seed: number; dist: number }[] = [];
    for (const e of this.world.query(Light2D)) {
      if (!e.activeInHierarchy) continue;
      const node = this.render.nodeOf(e);
      if (!node) continue;
      node.updateWorldMatrix(true, false);
      const pos = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
      const seed = [...e.id].reduce((n, c) => n + c.charCodeAt(0), 0);
      lights.push({ pos, d: e.require(Light2D), seed, dist: Math.hypot(pos.x - cam.x, pos.y - cam.y) });
    }
    lights.sort((a, b) => a.dist - b.dist);
    const n = Math.min(MAX_LIGHTS_2D, lights.length);
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const { pos, d, seed } = lights[i];
      // Flicker: two slow waves and a fast one, different for every light.
      const t = this.time + seed;
      const wave = 0.5 + 0.25 * Math.sin(t * 7.3) + 0.15 * Math.sin(t * 13.7) + 0.1 * Math.sin(t * 31.1);
      const k = d.intensity * (1 - d.flicker * wave * 0.6);
      color.set(d.color);
      u.uLight2DPos.value[i].set(pos.x, pos.y, Math.max(0.01, d.radius));
      u.uLight2DColor.value[i].set(color.r * k, color.g * k, color.b * k);
    }
    u.uLight2DCount.value = n;
    u.uAmbient2D.value = 1 - dark;
    u.uLight2DOn.value = n > 0 || dark > 0 ? 1 : 0;
  }
}
