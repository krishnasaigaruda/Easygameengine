import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { Label, ParticleSystem, type LabelData, type ParticleSystemData } from '../components/effects';
import type { RenderSystem } from './RenderSystem';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.001, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = (1.0 - smoothstep(0.05, 0.5, d)) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}`;

interface Emitter {
  /** Editor preview: seconds until a one-shot burst replays. */
  replayIn?: number;
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  cap: number;
  pos: Float32Array;
  vel: Float32Array;
  age: Float32Array;
  life: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  color: Float32Array;
  count: number;
  carry: number;
  burstDone: boolean;
}

export interface EffectsOptions {
  camera: () => THREE.Camera;
  /** Viewport height in device pixels (for particle sizes). */
  viewportHeight: () => number;
  /** "Coins: {game.score}" → "Coins: 3" (while playing). */
  format?: (template: string, entity: Entity) => string;
}

/**
 * Particle systems (simulated on the CPU, drawn as soft points in world space) and floating text
 * labels. Particles preview in the editor; both freeze while the game is paused (dt = 0).
 */
export class EffectsSystem implements System {
  readonly name = 'effects';
  readonly order = 1080;
  /** Particles live in world space so moving emitters leave trails. */
  readonly group = new THREE.Group();
  playing = false;
  private world: World | null = null;
  private readonly emitters = new Map<string, Emitter>();
  private readonly labels = new Map<string, { sprite: THREE.Sprite; key: string; canvas: HTMLCanvasElement }>();
  private readonly render: RenderSystem;
  private readonly options: EffectsOptions;
  private unsubscribers: (() => void)[] = [];

  constructor(scene: THREE.Scene, render: RenderSystem, options: EffectsOptions) {
    this.render = render;
    this.options = options;
    this.group.name = 'EGE:Effects';
    scene.add(this.group);
  }

  attach(world: World): void {
    this.world = world;
    const ev = world.events;
    this.unsubscribers = [
      ev.on('entityDestroyed', ({ entity }) => this.removeAll(entity.id)),
      ev.on('componentRemoved', ({ entity, type }) => {
        if (type === ParticleSystem.type) this.removeEmitter(entity.id);
        if (type === Label.type) this.removeLabel(entity.id);
      }),
    ];
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    for (const id of [...this.emitters.keys()]) this.removeEmitter(id);
    for (const id of [...this.labels.keys()]) this.removeLabel(id);
    this.world = null;
  }

  /** Restart every emitter (bursts fire again) — called when Play starts/stops. */
  reset(): void {
    for (const id of [...this.emitters.keys()]) this.removeEmitter(id);
  }

  /** Fire a particle system's burst again (EasyScript, explosions). */
  burst(entity: Entity): void {
    const em = this.emitters.get(entity.id);
    const data = entity.get(ParticleSystem);
    if (em && data) this.spawn(em, data, entity, data.burst || 30);
  }

  update(dt: number): void {
    const w = this.world;
    if (!w) return;
    const cam = this.options.camera() as THREE.PerspectiveCamera;
    const fov = cam.isPerspectiveCamera ? cam.fov : 60;
    const scale = this.options.viewportHeight() / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));

    for (const e of w.query(ParticleSystem)) {
      const data = e.require(ParticleSystem);
      const active = e.activeInHierarchy && (this.playing || data.previewInEditor);
      let em = this.emitters.get(e.id);
      if (!active) {
        if (em) this.removeEmitter(e.id);
        continue;
      }
      const cap = Math.max(1, Math.min(20000, Math.floor(data.maxParticles)));
      if (!em || em.cap !== cap) {
        if (em) this.removeEmitter(e.id);
        em = this.createEmitter(cap, data.glow);
        this.emitters.set(e.id, em);
      }
      em.mat.blending = data.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
      em.mat.uniforms.uScale.value = scale;
      this.simulate(em, data, e, dt);
    }

    for (const e of w.query(Label)) this.updateLabel(e, e.require(Label));
    for (const id of [...this.labels.keys()]) {
      const e = w.getById(id);
      if (!e?.has(Label)) this.removeLabel(id);
    }
  }

  get particleCount(): number {
    let n = 0;
    for (const em of this.emitters.values()) n += em.count;
    return n;
  }

  // ── particles ─────────────────────────────────────────────────────────────

  private createEmitter(cap: number, glow: boolean): Emitter {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(cap * 3);
    const size = new Float32Array(cap);
    const alpha = new Float32Array(cap);
    const color = new Float32Array(cap * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.userData.editorOnly = true; // not pickable
    this.group.add(points);
    return {
      points,
      geo,
      mat,
      cap,
      pos,
      vel: new Float32Array(cap * 3),
      age: new Float32Array(cap),
      life: new Float32Array(cap),
      size,
      alpha,
      color,
      count: 0,
      carry: 0,
      burstDone: false,
    };
  }

  private spawn(em: Emitter, d: ParticleSystemData, e: Entity, n: number): void {
    const node = this.render.nodeOf(e);
    const origin = new THREE.Vector3();
    const q = new THREE.Quaternion();
    if (node) {
      node.updateWorldMatrix(true, false);
      node.getWorldPosition(origin);
      node.getWorldQuaternion(q);
    }
    const spread = THREE.MathUtils.degToRad(Math.max(0, Math.min(180, d.spread)));
    const dir = new THREE.Vector3();
    for (let k = 0; k < n && em.count < em.cap; k++) {
      const i = em.count++;
      // Random point in a sphere of `radius`.
      const r = d.radius * Math.cbrt(Math.random());
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      em.pos[i * 3] = origin.x + r * Math.sin(ph) * Math.cos(th);
      em.pos[i * 3 + 1] = origin.y + r * Math.cos(ph);
      em.pos[i * 3 + 2] = origin.z + r * Math.sin(ph) * Math.sin(th);
      // Random direction inside the cone around the object's up axis.
      const cosA = 1 - Math.random() * (1 - Math.cos(spread));
      const sinA = Math.sqrt(1 - cosA * cosA);
      const az = Math.random() * Math.PI * 2;
      dir.set(sinA * Math.cos(az), cosA, sinA * Math.sin(az)).applyQuaternion(q);
      const sp = d.speed * (0.75 + Math.random() * 0.5);
      em.vel[i * 3] = dir.x * sp;
      em.vel[i * 3 + 1] = dir.y * sp;
      em.vel[i * 3 + 2] = dir.z * sp;
      em.age[i] = 0;
      em.life[i] = d.lifetime * (0.8 + Math.random() * 0.4);
    }
  }

  private simulate(em: Emitter, d: ParticleSystemData, e: Entity, dt: number): void {
    if (dt > 0) {
      if (!em.burstDone) {
        em.burstDone = true;
        if (d.burst > 0) this.spawn(em, d, e, Math.floor(d.burst));
      } else if (!this.playing && d.burst > 0 && d.rate <= 0 && em.count === 0) {
        // Editor preview of a one-shot effect (explosion, confetti): show it again and again.
        em.replayIn = (em.replayIn ?? 0.6) - dt;
        if (em.replayIn <= 0) {
          em.replayIn = 0.6;
          this.spawn(em, d, e, Math.floor(d.burst));
        }
      }
      if (d.emit && d.rate > 0) {
        em.carry += d.rate * dt;
        const n = Math.floor(em.carry);
        em.carry -= n;
        if (n > 0) this.spawn(em, d, e, n);
      }
      const g = -9.81 * d.gravity;
      for (let i = 0; i < em.count; ) {
        em.age[i] += dt;
        if (em.age[i] >= em.life[i]) {
          // Remove by swapping in the last particle.
          const last = --em.count;
          if (i !== last) {
            for (let c = 0; c < 3; c++) {
              em.pos[i * 3 + c] = em.pos[last * 3 + c];
              em.vel[i * 3 + c] = em.vel[last * 3 + c];
            }
            em.age[i] = em.age[last];
            em.life[i] = em.life[last];
          }
          continue;
        }
        em.vel[i * 3 + 1] += g * dt;
        em.pos[i * 3] += em.vel[i * 3] * dt;
        em.pos[i * 3 + 1] += em.vel[i * 3 + 1] * dt;
        em.pos[i * 3 + 2] += em.vel[i * 3 + 2] * dt;
        i++;
      }
    }
    const c0 = new THREE.Color(d.color);
    const c1 = new THREE.Color(d.colorEnd);
    const c = new THREE.Color();
    for (let i = 0; i < em.count; i++) {
      const t = Math.min(1, em.age[i] / em.life[i]);
      em.size[i] = d.size + (d.sizeEnd - d.size) * t;
      em.alpha[i] = d.opacity + (d.opacityEnd - d.opacity) * t;
      c.copy(c0).lerp(c1, t);
      em.color[i * 3] = c.r;
      em.color[i * 3 + 1] = c.g;
      em.color[i * 3 + 2] = c.b;
    }
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor']) (em.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    em.geo.setDrawRange(0, em.count);
  }

  private removeEmitter(id: string): void {
    const em = this.emitters.get(id);
    if (!em) return;
    em.points.removeFromParent();
    em.geo.dispose();
    em.mat.dispose();
    this.emitters.delete(id);
  }

  // ── labels ────────────────────────────────────────────────────────────────

  private updateLabel(e: Entity, d: LabelData): void {
    const node = this.render.nodeOf(e);
    if (!node) return;
    const text = this.playing && d.text.includes('{') && this.options.format ? this.options.format(d.text, e) : d.text;
    const key = [text, d.color, d.background, d.backgroundOpacity].join('|');
    let l = this.labels.get(e.id);
    if (!l) {
      const canvas = document.createElement('canvas');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.userData.editorOnly = true;
      l = { sprite, key: '', canvas };
      this.labels.set(e.id, l);
    }
    if (l.sprite.parent !== node) node.add(l.sprite);
    if (l.key !== key) {
      l.key = key;
      drawLabel(l.canvas, text, d);
      (l.sprite.material.map as THREE.CanvasTexture).needsUpdate = true;
    }
    const mat = l.sprite.material;
    mat.depthTest = !d.alwaysOnTop;
    l.sprite.renderOrder = d.alwaysOnTop ? 990 : 0;
    // Keep a constant size in meters no matter how the object is scaled.
    const ws = node.getWorldScale(new THREE.Vector3());
    const aspect = l.canvas.width / Math.max(1, l.canvas.height);
    l.sprite.scale.set((d.size * aspect * 1.6) / (ws.x || 1), (d.size * 1.6) / (ws.y || 1), 1);
    l.sprite.position.set(0, d.height / (ws.y || 1), 0);
    l.sprite.visible = e.activeInHierarchy;
  }

  private removeLabel(id: string): void {
    const l = this.labels.get(id);
    if (!l) return;
    l.sprite.removeFromParent();
    l.sprite.material.map?.dispose();
    l.sprite.material.dispose();
    this.labels.delete(id);
  }

  private removeAll(id: string): void {
    this.removeEmitter(id);
    this.removeLabel(id);
  }
}

function drawLabel(canvas: HTMLCanvasElement, text: string, d: LabelData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const px = 64;
  const font = `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font;
  const lines = text.split('\n');
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + px;
  const h = Math.ceil(lines.length * px * 1.25) + px * 0.5;
  canvas.width = Math.max(2, w);
  canvas.height = Math.max(2, h);
  ctx.font = font;
  if (d.backgroundOpacity > 0) {
    ctx.globalAlpha = d.backgroundOpacity;
    ctx.fillStyle = d.background;
    const r = px * 0.35;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, r);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = d.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, px * 0.25 + px * 1.25 * (i + 0.5)));
}
