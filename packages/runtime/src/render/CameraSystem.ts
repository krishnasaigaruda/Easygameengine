import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { Camera, Transform } from '../components/builtin';
import { FollowCamera, type FollowCameraData } from '../components/camera';
import { worldMatrixOf, worldPoseToLocal } from '../core/transformMath';
import type { Input } from '../input/Input';
import type { PhysicsSystem } from '../physics/PhysicsSystem';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
/** Degrees per second the right stick turns the view at full tilt. */
const STICK_SPEED = 150;

interface Orbit {
  yaw: number;
  pitch: number;
  pos: THREE.Vector3 | null;
  /** look-around: where the camera started. */
  home?: { pos: THREE.Vector3; yaw: number; pitch: number };
}

export interface CameraSystemOptions {
  input?: Input;
  physics?: PhysicsSystem;
  /** True while the mouse is captured (mouse movement then always turns the camera). */
  pointerLocked?: () => boolean;
  /** Canvas size in CSS pixels (for edge panning). */
  viewport?: () => { width: number; height: number };
  /** The scene node of an entity (first person hides the player's own body). */
  nodeOf?: (e: Entity) => THREE.Object3D | undefined;
}

/**
 * Drives FollowCamera components while the game runs: orbit around the target with mouse /
 * right stick, stay over the shoulder, and pull in when a wall is in the way.
 */
export class CameraSystem implements System {
  readonly name = 'cameras';
  readonly order = 700;
  private world: World | null = null;
  private readonly orbits = new Map<string, Orbit>();
  private readonly options: CameraSystemOptions;
  private running = false;
  /** In first person the camera sits inside the player: its body is hidden (shown again after). */
  private hiddenBody: THREE.Object3D | null = null;

  constructor(options: CameraSystemOptions = {}) {
    this.options = options;
  }

  attach(world: World): void {
    this.world = world;
  }

  detach(): void {
    this.world = null;
    this.orbits.clear();
  }

  setRunning(on: boolean): void {
    this.running = on;
    if (!on) this.showBody();
    this.orbits.clear();
  }

  /** Does the active camera controller want the mouse captured? (Not look-around with edge panning.) */
  wantsPointerLock(): boolean {
    if (!this.world) return false;
    for (const e of this.world.query(FollowCamera)) {
      if (!e.activeInHierarchy) continue;
      const f = e.require(FollowCamera);
      if (f.lockMouse && !(f.mode === 'look-around' && f.edgePan)) return true;
    }
    return false;
  }

  update(dt: number): void {
    if (!this.running || !this.world || dt <= 0) return;
    let body: THREE.Object3D | null = null;
    for (const cam of this.world.query(FollowCamera, Camera)) {
      if (!cam.activeInHierarchy) continue;
      this.follow(cam, dt);
      const f = cam.require(FollowCamera);
      const target = f.mode === 'first-person' ? this.targetOf(cam) : undefined;
      if (target && target !== cam) body = this.options.nodeOf?.(target) ?? null;
    }
    if (body !== this.hiddenBody) {
      this.showBody();
      if (body) {
        body.visible = false;
        this.hiddenBody = body;
      }
    }
  }

  private showBody(): void {
    if (this.hiddenBody) this.hiddenBody.visible = true;
    this.hiddenBody = null;
  }

  private targetOf(cam: Entity): Entity | undefined {
    const name = cam.require(FollowCamera).target.trim();
    const w = this.world!;
    return (name ? w.findByName(name) : undefined) ?? w.findByTag('player')[0];
  }

  private follow(cam: Entity, dt: number): void {
    const f = cam.require(FollowCamera);
    if (f.mode === 'look-around') return this.lookAround(cam, f, dt);
    const target = this.targetOf(cam);
    if (!target || target === cam) return;

    let o = this.orbits.get(cam.id);
    if (!o) {
      // Start from where the camera was placed: keep its heading, use the configured tilt.
      const t = cam.get(Transform);
      o = { yaw: (t?.rotation[1] ?? 0) * DEG, pitch: f.pitch * DEG, pos: null };
      this.orbits.set(cam.id, o);
    }

    const input = this.options.input;
    if (input) {
      const locked = this.options.pointerLocked?.() ?? false;
      const dragging = input.isDown('Mouse:2') || input.isDown('Mouse:0') || input.touch.looking;
      if (locked || dragging) {
        o.yaw -= input.pointer.dx * f.sensitivity * DEG;
        o.pitch += input.pointer.dy * f.sensitivity * DEG;
      }
      o.yaw -= input.axis('lookX') * STICK_SPEED * DEG * dt;
      o.pitch -= input.axis('lookY') * STICK_SPEED * DEG * dt;
    }
    o.pitch = THREE.MathUtils.clamp(o.pitch, f.minPitch * DEG, f.maxPitch * DEG);

    const pivot = new THREE.Vector3().setFromMatrixPosition(worldMatrixOf(target)).add(new THREE.Vector3(0, f.height, 0));

    if (f.mode === 'first-person') {
      // From the eyes: position is the pivot, the view turns with the mouse.
      const look = new THREE.Vector3(-Math.sin(o.yaw) * Math.cos(o.pitch), -Math.sin(o.pitch), -Math.cos(o.yaw) * Math.cos(o.pitch));
      this.place(cam, pivot, pivot.clone().add(look));
      return;
    }
    if (f.mode === 'top-down' || f.mode === 'side-view') {
      // Fixed angle; follows smoothly. Top-down looks down at `pitch`, side view from +Z.
      const pitch = f.mode === 'top-down' ? Math.max(20, f.pitch) * DEG : f.pitch * DEG;
      const yaw = f.mode === 'side-view' ? 0 : o.yaw;
      const offset = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(f.distance);
      const desired = pivot.clone().add(offset);
      if (!o.pos) o.pos = desired.clone();
      else o.pos.lerp(desired, 1 - Math.exp(-f.smoothing * dt));
      this.place(cam, o.pos, pivot);
      return;
    }

    const back = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw));
    const right = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw));
    const shoulderPivot = pivot.clone().addScaledVector(right, f.shoulder);
    const offset = back.multiplyScalar(Math.cos(o.pitch) * f.distance).addScaledVector(UP, Math.sin(o.pitch) * f.distance);
    let desired = shoulderPivot.clone().add(offset);

    // Pull in when a wall/rock is between the camera and the player.
    if (f.avoidWalls && this.options.physics) {
      const dir = desired.clone().sub(shoulderPivot);
      const len = dir.length();
      const hit = len > 0.01 ? this.options.physics.raycast(shoulderPivot, dir, len, target) : null;
      if (hit && hit.entity !== cam) desired = shoulderPivot.clone().addScaledVector(dir.normalize(), Math.max(0.3, hit.distance - 0.25));
    }

    if (!o.pos) o.pos = desired.clone();
    else {
      const k = 1 - Math.exp(-f.smoothing * dt);
      o.pos.lerp(desired, k);
      // Never smooth *into* a wall: if the safe spot is closer, snap there.
      if (o.pos.distanceTo(shoulderPivot) > desired.distanceTo(shoulderPivot) + 0.05) o.pos.copy(desired);
    }

    this.place(cam, o.pos, shoulderPivot);
  }

  /** Fixed spot; the mouse (edge panning or captured) turns it within limits. */
  private lookAround(cam: Entity, f: FollowCameraData, dt: number): void {
    let o = this.orbits.get(cam.id);
    if (!o) {
      const m = worldMatrixOf(cam);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      const pitch = -Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
      o = { yaw, pitch, pos, home: { pos, yaw, pitch } };
      this.orbits.set(cam.id, o);
    }
    const home = o.home!;
    const input = this.options.input;
    const range = f.yawRange * DEG;
    if (input) {
      if (f.edgePan) {
        // Mouse toward the left/right edge turns the view that way (smoothly).
        const vp = this.options.viewport?.() ?? { width: 1, height: 1 };
        const nx = THREE.MathUtils.clamp((input.pointer.x / Math.max(1, vp.width)) * 2 - 1, -1, 1);
        const ny = THREE.MathUtils.clamp((input.pointer.y / Math.max(1, vp.height)) * 2 - 1, -1, 1);
        const edge = (v: number) => (Math.sign(v) * Math.max(0, Math.abs(v) - 0.35)) / 0.65;
        o.yaw -= edge(nx) * 1.6 * dt;
        o.pitch += edge(ny) * 0.8 * dt;
      } else if (this.options.pointerLocked?.() || input.isDown('Mouse:0') || input.isDown('Mouse:2') || input.touch.looking) {
        o.yaw -= input.pointer.dx * f.sensitivity * DEG;
        o.pitch += input.pointer.dy * f.sensitivity * DEG;
      }
      o.yaw -= input.axis('lookX') * STICK_SPEED * DEG * dt * 0.5;
    }
    o.yaw = THREE.MathUtils.clamp(o.yaw, home.yaw - range, home.yaw + range);
    o.pitch = THREE.MathUtils.clamp(o.pitch, Math.max(f.minPitch * DEG, home.pitch - 0.6), Math.min(f.maxPitch * DEG, home.pitch + 0.6));
    const look = new THREE.Vector3(-Math.sin(o.yaw) * Math.cos(o.pitch), -Math.sin(o.pitch), -Math.cos(o.yaw) * Math.cos(o.pitch));
    this.place(cam, home.pos, home.pos.clone().add(look));
  }

  /** Put the camera at `pos` looking at `at` (written directly, like physics write-back). */
  private place(cam: Entity, pos: THREE.Vector3, at: THREE.Vector3): void {
    const look = new THREE.Matrix4().lookAt(pos, at, UP);
    const q = new THREE.Quaternion().setFromRotationMatrix(look);
    const local = worldPoseToLocal(cam, pos, q);
    const tr = cam.require(Transform);
    tr.position = local.position;
    tr.rotation = local.rotation;
  }

  /** Recoil: tip every active camera controller up a little (degrees). */
  kick(degrees: number): void {
    for (const o of this.orbits.values()) o.pitch -= degrees * DEG * (0.7 + Math.random() * 0.6);
  }

  /** Current yaw/pitch (degrees) — for tests and debugging. */
  orbitOf(cam: Entity): { yaw: number; pitch: number } | undefined {
    const o = this.orbits.get(cam.id);
    return o ? { yaw: o.yaw / DEG, pitch: o.pitch / DEG } : undefined;
  }
}
