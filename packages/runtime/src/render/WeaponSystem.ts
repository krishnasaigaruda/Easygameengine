import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { Weapon, type WeaponData } from '../components/weapon';
import { FollowCamera } from '../components/camera';
import { CharacterController, RigidBody } from '../components/physics';
import type { PhysicsSystem } from '../physics/PhysicsSystem';
import type { ScriptSystem } from '../easyscript/ScriptSystem';
import type { Input } from '../input/Input';
import type { RenderSystem } from './RenderSystem';
import type { AssetManager } from '../assets/AssetManager';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

interface WeaponState {
  cooldown: number;
  ammo: number;
  reserve: number;
  reloadingUntil: number;
  /** A script asked to fire ({ fire: "self" }). */
  queued: number;
  held: THREE.Object3D | null;
  heldKey: string;
  kick: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  life: number;
  shooter: Entity;
  weapon: WeaponData;
  stuck?: number;
}

interface Flash {
  obj: THREE.Object3D;
  life: number;
  total: number;
}

export interface WeaponOptions {
  physics: PhysicsSystem | null;
  scripts: () => ScriptSystem | null;
  input: Input | null;
  render: RenderSystem;
  scene: THREE.Scene;
  camera: () => THREE.Camera;
  assets?: AssetManager | null;
  /** Camera kick for recoil (degrees up). */
  kick?: (degrees: number) => void;
  /** One-shot sounds (fire / hit). */
  sound?: (assetId: string, at: THREE.Vector3 | null) => void;
}

/**
 * Weapon components: guns (instant hits), projectiles (arrows, rockets) and melee. Firing comes
 * from the mouse for the player, or from scripts ({ fire: "self" }) for anyone. Hits call the
 * target's "takeDamage" script function and send it a "hit" message.
 */
export class WeaponSystem implements System {
  readonly name = 'weapons';
  readonly order = 960;
  playing = false;
  private world: World | null = null;
  private readonly states = new Map<string, WeaponState>();
  private readonly projectiles: Projectile[] = [];
  private readonly flashes: Flash[] = [];
  private time = 0;

  constructor(private readonly o: WeaponOptions) {}

  attach(world: World): void {
    this.world = world;
  }

  detach(): void {
    this.reset();
    this.world = null;
  }

  /** Play started/stopped: full magazines, no arrows left flying. */
  reset(): void {
    for (const s of this.states.values()) s.held?.removeFromParent();
    this.states.clear();
    for (const p of this.projectiles) p.mesh.removeFromParent();
    this.projectiles.length = 0;
    for (const f of this.flashes) f.obj.removeFromParent();
    this.flashes.length = 0;
  }

  /** Scripts: { fire: "self" } — fire as soon as the weapon is ready. */
  trigger(e: Entity): void {
    const s = this.state(e);
    if (s) s.queued = this.time + 0.25;
  }

  /** Scripts: { reload: "self" }. */
  reload(e: Entity): void {
    const w = e.get(Weapon);
    const s = this.state(e);
    if (w && s) this.startReload(w, s);
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || !this.playing || dt <= 0) return;
    this.time += dt;
    const input = this.o.input;
    for (const e of world.query(Weapon)) {
      if (!e.activeInHierarchy) {
        // Put away (switched to another weapon): hide what it shows in your hands.
        const held = this.states.get(e.id)?.held;
        if (held) held.visible = false;
        continue;
      }
      const w = e.require(Weapon);
      const s = this.state(e)!;
      this.updateHeld(e, w, s, dt);
      s.cooldown -= dt;
      if (s.reloadingUntil && this.time >= s.reloadingUntil) {
        const take = w.reserve < 0 ? w.magazine - s.ammo : Math.min(w.magazine - s.ammo, s.reserve);
        s.ammo += take;
        if (w.reserve >= 0) s.reserve -= take;
        s.reloadingUntil = 0;
        this.publish(e, s);
      }
      const holder = this.holder(e);
      const isPlayer = w.playerControlled && !!input && !!holder.get(CharacterController)?.playerControlled;
      let wants = s.queued > this.time;
      if (isPlayer) {
        wants ||= w.automatic ? input!.action('fire') : input!.actionPressed('fire');
        if (input!.wasPressed('Key:KeyR')) this.startReload(w, s);
      }
      if (!wants || s.cooldown > 0 || s.reloadingUntil) continue;
      if (w.magazine > 0 && s.ammo <= 0) {
        this.startReload(w, s);
        continue;
      }
      s.queued = 0;
      s.cooldown = 1 / Math.max(0.05, w.fireRate);
      if (w.magazine > 0) s.ammo--;
      this.shoot(e, w, s);
      this.publish(e, s);
    }
    this.updateProjectiles(dt);
    this.updateFlashes(dt);
  }

  // ── firing ────────────────────────────────────────────────────────────────

  private state(e: Entity): WeaponState | null {
    const w = e.get(Weapon);
    if (!w) return null;
    let s = this.states.get(e.id);
    if (!s) {
      s = { cooldown: 0, ammo: w.magazine, reserve: w.magazine > 0 ? w.reserve : -1, reloadingUntil: 0, queued: 0, held: null, heldKey: '', kick: 0 };
      this.states.set(e.id, s);
      this.publish(e, s);
    }
    return s;
  }

  private startReload(w: WeaponData, s: WeaponState): void {
    if (w.magazine <= 0 || s.ammo >= w.magazine || s.reloadingUntil || s.reserve === 0) return;
    s.reloadingUntil = this.time + w.reloadTime;
  }

  /** Ammo is visible to scripts and UI: self.ammo, self.reserve, self.reloading. */
  private publish(e: Entity, s: WeaponState): void {
    const scripts = this.o.scripts();
    if (!scripts) return;
    scripts.setVar(e, 'ammo', s.ammo);
    scripts.setVar(e, 'reserve', s.reserve < 0 ? '∞' : s.reserve);
    scripts.setVar(e, 'reloading', s.reloadingUntil > 0);
  }

  /** Who holds a weapon: the nearest character above it (a weapon can be a child, like an inventory). */
  private holder(e: Entity): Entity {
    for (let p: Entity | null = e; p; p = p.parent) if (p.has(CharacterController)) return p;
    return e;
  }

  /** First-person: follows this entity with a first-person camera controller. */
  private firstPerson(e: Entity): boolean {
    for (const c of this.world?.query(FollowCamera) ?? []) {
      const f = c.require(FollowCamera);
      if (c.activeInHierarchy && f.mode === 'first-person' && (f.target === e.name || (!f.target && e.tags.has('player')))) return true;
    }
    return false;
  }

  private aim(weapon: Entity, w: WeaponData): { origin: THREE.Vector3; dir: THREE.Vector3; fromCamera: boolean } {
    const e = this.holder(weapon);
    const useCamera = w.aim === 'camera' || (w.aim === 'auto' && this.firstPerson(e));
    if (useCamera) {
      const cam = this.o.camera();
      cam.updateWorldMatrix(true, false);
      const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
      return { origin, dir, fromCamera: true };
    }
    const node = this.o.render.nodeOf(e)!;
    node.updateWorldMatrix(true, false);
    const q = node.getWorldQuaternion(new THREE.Quaternion());
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    dir.y = 0;
    dir.normalize();
    const origin = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(dir, 0.5);
    return { origin, dir, fromCamera: false };
  }

  private spreadDir(dir: THREE.Vector3, degrees: number): THREE.Vector3 {
    if (degrees <= 0) return dir.clone();
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * Math.tan(degrees * DEG);
    const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    return dir.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }

  private shoot(e: Entity, w: WeaponData, s: WeaponState): void {
    const { origin, dir, fromCamera } = this.aim(e, w);
    const shooter = this.holder(e);
    s.kick = 1;
    if (fromCamera && w.recoil > 0) this.o.kick?.(w.recoil);
    if (w.fireSound) this.o.sound?.(w.fireSound, fromCamera ? null : origin.clone());
    this.o.scripts()?.notify(e, 'fired');
    if (w.kind === 'melee') return this.swing(shooter, w, origin, dir);
    for (let i = 0; i < Math.max(1, Math.round(w.pellets)); i++) {
      const d = this.spreadDir(dir, w.spread);
      if (w.kind === 'projectile') this.launch(shooter, w, origin, d);
      else this.hitscan(shooter, w, origin, d);
    }
  }

  private hitscan(e: Entity, w: WeaponData, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const hit = this.o.physics?.raycast(origin, dir, w.range, e) ?? null;
    const end = origin.clone().addScaledVector(dir, hit ? hit.distance : w.range);
    // Tracer from just below the eye so it doesn't sit in the middle of the screen.
    const start = origin.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.12, 0));
    this.flash(this.line(start, end, w.projectileColor), 0.06);
    if (hit) {
      this.flash(this.spark(end, w.projectileColor, 0.12), 0.12);
      if (hit.entity) this.damage(hit.entity, e, w, dir);
    }
  }

  private launch(e: Entity, w: WeaponData, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const len = w.projectileGravity > 0 ? 0.8 : 0.5; // arrows are long, rockets/fireballs short
    const geo = new THREE.CylinderGeometry(0.02, 0.02, len, 6).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: w.projectileColor, emissive: w.projectileGravity > 0 ? '#000000' : w.projectileColor, emissiveIntensity: 2, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.editorOnly = true;
    const pos = origin.clone().addScaledVector(dir, 0.7);
    mesh.position.copy(pos);
    this.o.scene.add(mesh);
    this.projectiles.push({ mesh, pos, vel: dir.clone().multiplyScalar(w.projectileSpeed), gravity: w.projectileGravity, life: 6, shooter: e, weapon: w });
  }

  private swing(e: Entity, w: WeaponData, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const cos = Math.cos(Math.max(5, w.spread) * DEG);
    const flat = dir.clone().setY(0).normalize();
    for (const t of this.world?.all() ?? []) {
      if (t === e || !t.activeInHierarchy || !this.o.scripts()?.hasFunction(t, 'takeDamage')) continue;
      const node = this.o.render.nodeOf(t);
      if (!node) continue;
      node.updateWorldMatrix(true, false);
      const to = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).add(new THREE.Vector3(0, 1, 0)).sub(origin);
      const dist = to.length();
      const flatTo = to.clone().setY(0);
      if (dist > w.range + 0.5 || flatTo.lengthSq() < 1e-6 || flatTo.normalize().dot(flat) < cos) continue;
      this.damage(t, e, w, flat);
    }
  }

  private damage(target: Entity, shooter: Entity, w: WeaponData, dir: THREE.Vector3): void {
    const scripts = this.o.scripts();
    // Hitting a child (an arm, a door panel) counts as hitting whatever owns the health.
    let t: Entity | null = target;
    while (t && !scripts?.hasFunction(t, 'takeDamage')) t = t.parent;
    const victim = t ?? target;
    scripts?.invoke(victim, 'takeDamage', { amount: w.damage }, shooter);
    if (w.hitSound) {
      const node = this.o.render.nodeOf(victim);
      this.o.sound?.(w.hitSound, node ? new THREE.Vector3().setFromMatrixPosition(node.matrixWorld) : null);
    }
    scripts?.notify(victim, 'hit', shooter);
    if (w.knockback > 0) {
      const push = dir.clone().setY(0).normalize().multiplyScalar(w.knockback).add(new THREE.Vector3(0, w.knockback * 0.25, 0));
      if (victim.get(CharacterController)) this.o.physics?.setVelocity(victim, push);
      else if (victim.get(RigidBody)?.type === 'dynamic') this.o.physics?.applyImpulse(victim, push.multiplyScalar((victim.get(RigidBody)?.mass ?? 1) * 0.5));
    }
  }

  // ── projectiles and effects ───────────────────────────────────────────────

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.stuck !== undefined) {
        // Arrows stay stuck in what they hit for a while.
        if (p.life <= 0) {
          p.mesh.removeFromParent();
          this.projectiles.splice(i, 1);
        }
        continue;
      }
      p.vel.y -= 9.81 * p.gravity * dt;
      const step = p.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hit = len > 0 ? this.o.physics?.raycast(p.pos, step.clone().normalize(), len, p.shooter) : null;
      if (hit) {
        p.pos.addScaledVector(step.normalize(), hit.distance);
        p.mesh.position.copy(p.pos);
        if (hit.entity) this.damage(hit.entity, p.shooter, p.weapon, p.vel.clone().normalize());
        if (p.gravity > 0) {
          p.stuck = 1;
          p.life = 8;
          // Ride along with what it hit.
          const node = hit.entity ? this.o.render.nodeOf(hit.entity) : null;
          if (node) node.attach(p.mesh);
        } else {
          this.flash(this.spark(p.pos, p.weapon.projectileColor, 0.6), 0.25); // a small blast
          p.mesh.removeFromParent();
          this.projectiles.splice(i, 1);
        }
        continue;
      }
      p.pos.add(step);
      p.mesh.position.copy(p.pos);
      p.mesh.lookAt(p.pos.clone().add(p.vel));
      if (p.life <= 0 || p.pos.y < -200) {
        p.mesh.removeFromParent();
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** Projectiles flying right now (tests). */
  get flying(): number {
    return this.projectiles.filter((p) => p.stuck === undefined).length;
  }

  private line(a: THREE.Vector3, b: THREE.Vector3, color: string): THREE.Line {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    l.userData.editorOnly = true;
    return l;
  }

  private spark(at: THREE.Vector3, color: string, size: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(at);
    m.userData.editorOnly = true;
    return m;
  }

  private flash(obj: THREE.Object3D, life: number): void {
    this.o.scene.add(obj);
    this.flashes.push({ obj, life, total: life });
  }

  private updateFlashes(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const mat = (f.obj as THREE.Mesh).material as THREE.Material & { opacity: number };
      if (mat) mat.opacity = Math.max(0, f.life / f.total);
      if (f.life <= 0) {
        f.obj.removeFromParent();
        (f.obj as THREE.Mesh).geometry?.dispose();
        mat?.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  // ── what you hold ─────────────────────────────────────────────────────────

  private updateHeld(weapon: Entity, w: WeaponData, s: WeaponState, dt: number): void {
    const e = this.holder(weapon);
    const fp = this.firstPerson(e);
    const key = `${w.look}|${w.model}|${fp}`;
    if (s.heldKey !== key) {
      s.held?.removeFromParent();
      s.held = w.look === 'none' ? null : heldModel(w.look);
      s.heldKey = key;
      if (s.held && w.look === 'model' && w.model && this.o.assets) {
        const holder = s.held;
        void this.o.assets.instantiate(w.model).then(({ object }) => {
          const box = new THREE.Box3().setFromObject(object);
          const size = box.getSize(new THREE.Vector3()).length() || 1;
          object.scale.multiplyScalar(0.6 / size);
          holder.add(object);
        });
      }
      if (s.held) {
        s.held.traverse((o) => (o.userData.editorOnly = true));
        if (fp) this.o.camera().add(s.held);
        else this.o.render.nodeOf(e)?.add(s.held);
      }
    }
    if (!s.held) return;
    s.held.visible = true;
    // Recoil / swing animation: kick back, then settle.
    s.kick = Math.max(0, s.kick - dt * 6);
    const k = s.kick * s.kick;
    const reloading = s.reloadingUntil > 0 ? 1 : 0;
    if (fp) {
      s.held.position.set(0.28, -0.25 - reloading * 0.15, -0.55 + k * (w.kind === 'melee' ? -0.25 : 0.08));
      s.held.rotation.set(k * (w.kind === 'melee' ? -1.2 : 0.25) - reloading * 0.6, w.kind === 'melee' ? -k * 0.8 : 0, 0);
    } else {
      s.held.position.set(0.35, 1.15, 0.35 + k * 0.1);
      s.held.rotation.set(0, Math.PI, 0);
    }
  }
}

/** Simple built-in shapes to hold (no download needed). Points along -Z, like the camera. */
function heldModel(look: WeaponData['look']): THREE.Object3D {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#2b2d31', metalness: 0.8, roughness: 0.35 });
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 1, roughness: 0.2 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  switch (look) {
    case 'pistol':
      box(0.05, 0.07, 0.22, metal, 0, 0, -0.05);
      box(0.04, 0.12, 0.05, metal, 0, -0.08, 0.03).rotation.x = -0.25;
      break;
    case 'rifle':
      box(0.06, 0.08, 0.55, metal, 0, 0, -0.15);
      box(0.05, 0.1, 0.18, wood, 0, -0.03, 0.18);
      box(0.04, 0.12, 0.05, metal, 0, -0.09, -0.02).rotation.x = -0.25;
      break;
    case 'shotgun':
      box(0.07, 0.07, 0.6, metal, 0, 0, -0.18);
      box(0.06, 0.06, 0.3, wood, 0, -0.06, -0.15);
      box(0.06, 0.11, 0.2, wood, 0, -0.04, 0.2);
      break;
    case 'bow': {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.012, 6, 32, Math.PI * 0.9), wood);
      arc.rotation.set(0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.05);
      arc.position.set(0, 0, -0.05);
      g.add(arc);
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.62, 4), new THREE.MeshBasicMaterial({ color: '#ddd8c8' }));
      string.position.set(0, 0, 0.02);
      g.add(string);
      g.rotation.z = -0.2;
      break;
    }
    case 'sword':
      box(0.05, 0.7, 0.012, steel, 0, 0.42, 0);
      box(0.18, 0.025, 0.04, metal, 0, 0.06, 0);
      box(0.035, 0.14, 0.035, wood, 0, -0.02, 0);
      g.rotation.x = -0.6;
      break;
    case 'model':
    case 'none':
      break;
  }
  return g;
}
