import * as THREE from 'three';
import { Sprite } from '../components/sprite';
import { Tilemap, solidRuns } from '../components/tilemap';
import { Terrain } from '../components/terrain';
import { Scatter } from '../components/foliage';
import { scatterColliders, type Placement } from '../terrain/scatter';
import type { Heightmap } from '../terrain/heightmap';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { EventBus } from '../core/EventBus';
import { MeshRenderer, ModelRenderer, Transform } from '../components/builtin';
import {
  CharacterController,
  Climbable,
  Collider,
  RigidBody,
  Water,
  type CharacterControllerData,
  type ColliderData,
  type RigidBodyData,
} from '../components/physics';
import { worldMatrixOf, worldPoseToLocal } from '../core/transformMath';
import type { RenderSystem } from '../render/RenderSystem';
import type { Input } from '../input/Input';

type Rapier = typeof RAPIER_NS;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 9.81;
/** A jump pressed slightly before landing still counts. */
const JUMP_BUFFER_S = 0.15;
/**
 * Gap the character controller keeps from surfaces. A capsule that *starts* touching the ground
 * slowly sinks into it, so characters spawn this much higher and we subtract it again when
 * writing the Transform — visually the feet stay exactly where the user put them.
 */
const CHARACTER_SKIN = 0.02;

export interface PhysicsEvents {
  collisionEnter: { a: Entity; b: Entity };
  collisionExit: { a: Entity; b: Entity };
  triggerEnter: { trigger: Entity; other: Entity };
  triggerExit: { trigger: Entity; other: Entity };
}

type BodyKind = 'dynamic' | 'static' | 'kinematic' | 'character';

interface BodyState {
  kind: BodyKind;
  body: RAPIER_NS.RigidBody;
  colliders: RAPIER_NS.Collider[];
  controller?: RAPIER_NS.KinematicCharacterController;
  verticalVelocity: number;
  grounded: boolean;
  /** World scale baked into collider sizes; a change means rebuild. */
  scale: THREE.Vector3;
  /** Mesh collider waiting for its model to finish loading. */
  waitingForModel: boolean;
  /** Colliders a character is currently pressing against (for touch events). */
  touching?: Set<number>;
  /** Character movement mode. */
  mode: 'walk' | 'climb' | 'swim';
  /** Direction from the last climbed wall toward the character. */
  climbNormal: THREE.Vector3;
  climbCooldown?: number;
  /** Short forced move (mounting a ledge, jumping off a wall). */
  boost?: { dir: THREE.Vector3; until: number };
  /** AI movement request (non-player characters). */
  intent?: { dir: THREE.Vector3; run: boolean; until: number };
  /** A dynamic body being carried: simulation paused, it follows its Transform. */
  held?: boolean;
  /** How far this (non-dynamic) body moved / turned in the last step — characters standing on it ride along. */
  moved?: THREE.Vector3;
  turned?: THREE.Quaternion;
  /** Entity id of what this character stands on. */
  groundId?: string;
  /** Characters: sideways speed from being launched/knocked back (fades out). */
  momentum?: THREE.Vector3;
  /** Characters with a locked axis: the coordinate they stay at. */
  lockAt?: number;
  /** Characters: sideways speed (m/s), kept between steps so ice can make it slide. */
  slide?: THREE.Vector3;
}

export interface PhysicsOptions {
  input?: Input;
  /** Camera that character movement is relative to ("W" = away from the camera). */
  camera?: () => THREE.Camera | undefined;
  /** Live terrain heights by entity id (for heightfield colliders). */
  terrain?: (entityId: string) => Heightmap | null;
  /** Where an entity's Scatter things are (trunks and rocks become solid). */
  scatter?: (e: Entity) => Placement[];
}

const PHYSICS_TYPES = new Set([RigidBody.type, Collider.type, CharacterController.type]);
/** Components whose change can alter an "auto" collider. */
const SHAPE_SOURCES = new Set([MeshRenderer.type, ModelRenderer.type, Terrain.type, Scatter.type, Tilemap.type]);

/**
 * Mirrors RigidBody / Collider / CharacterController components into a Rapier world.
 * In edit mode bodies just follow their Transforms (so collider debug view is accurate);
 * while simulating, dynamic bodies and characters drive their Transforms instead.
 */
export class PhysicsSystem implements System {
  readonly name = 'physics';
  readonly order = 500;
  readonly events = new EventBus<PhysicsEvents>();
  world: RAPIER_NS.World;
  private readonly rapier: Rapier;
  private readonly render: RenderSystem | null;
  private readonly options: PhysicsOptions;
  private readonly states = new Map<string, BodyState>();
  private readonly colliderOwner = new Map<number, string>();
  private readonly dirty = new Set<string>();
  private readonly eventQueue: RAPIER_NS.EventQueue;
  private ecs: World | null = null;
  private unsubscribers: (() => void)[] = [];
  private _simulating = false;
  private jumpBuffer = 0;
  /** Seconds of simulation so far (for short timers like ledge boosts). */
  private simTime = 0;

  constructor(rapier: Rapier, render: RenderSystem | null = null, options: PhysicsOptions = {}) {
    this.rapier = rapier;
    this.render = render;
    this.options = options;
    this.world = new rapier.World({ x: 0, y: -GRAVITY, z: 0 });
    this.eventQueue = new rapier.EventQueue(true);
  }

  get simulating(): boolean {
    return this._simulating;
  }

  /** Start/stop the simulation. Bodies are rebuilt fresh so nothing carries over. */
  setSimulating(on: boolean): void {
    if (on === this._simulating) return;
    this._simulating = on;
    this.jumpBuffer = 0;
    if (this.ecs) for (const e of this.ecs.all()) this.dirty.add(e.id);
    this.flush();
  }

  attach(world: World): void {
    this.ecs = world;
    const ev = world.events;
    const markTree = (e: Entity) => {
      for (const d of e.descendants(true)) this.dirty.add(d.id);
    };
    this.unsubscribers = [
      ev.on('componentAdded', ({ entity, type }) => this.onComponent(entity, type)),
      ev.on('componentChanged', ({ entity, type }) => this.onComponent(entity, type)),
      ev.on('componentRemoved', ({ entity, type }) => this.onComponent(entity, type)),
      ev.on('entityDestroyed', ({ entity }) => this.remove(entity.id)),
      ev.on('hierarchyChanged', ({ entity }) => markTree(entity)),
      ev.on('entityEnabledChanged', ({ entity }) => markTree(entity)),
      ev.on('entityVisualsChanged', ({ entity }) => {
        if (this.states.get(entity.id)?.waitingForModel || (needsBody(entity) && !this.states.has(entity.id))) {
          this.dirty.add(entity.id);
        }
      }),
    ];
    for (const e of world.all()) this.dirty.add(e.id);
    this.flush();
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    for (const id of [...this.states.keys()]) this.remove(id);
    this.ecs = null;
  }

  dispose(): void {
    this.detach();
    this.eventQueue.free();
    this.world.free();
  }

  fixedUpdate(dt: number): void {
    this.flush();
    const ecs = this.ecs;
    if (!ecs) return;
    if (!this._simulating) return;

    for (const [id, s] of this.states) {
      const e = ecs.getById(id);
      if (!e) continue;
      if (s.kind === 'character') this.moveCharacter(e, s, dt);
      else if (s.kind !== 'dynamic' || s.held) this.followTransform(e, s, true);
    }
    this.simTime += dt;
    if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    this.world.timestep = dt;
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((h1, h2, started) => this.dispatchCollision(h1, h2, started));
  }

  update(dt = 0): void {
    const ecs = this.ecs;
    if (!ecs) return;
    if (this._simulating) {
      // While paused (dt 0) a Space press must not queue a jump for later.
      if (dt > 0 && this.options.input?.actionPressed('jump')) this.jumpBuffer = JUMP_BUFFER_S;
      // Physics drives these objects: copy body poses back into Transforms.
      for (const [id, s] of this.states) {
        if ((s.kind !== 'dynamic' && s.kind !== 'character') || s.held) continue;
        const e = ecs.getById(id);
        if (!e || !e.has(Transform)) continue;
        const t = s.body.translation();
        const r = s.body.rotation();
        const y = s.kind === 'character' ? t.y - CHARACTER_SKIN : t.y;
        const local = worldPoseToLocal(e, new THREE.Vector3(t.x, y, t.z), new THREE.Quaternion(r.x, r.y, r.z, r.w));
        const tr = e.require(Transform);
        tr.position = local.position;
        if (s.kind === 'character' && !e.parent) {
          // Characters only turn around Y; show that as a plain Y angle instead of the
          // equivalent-but-confusing (180, 0, 180) a generic decomposition can give.
          const f = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
          tr.rotation = [0, Math.round((Math.atan2(f.x, f.z) / DEG) * 1000) / 1000, 0];
        } else {
          tr.rotation = local.rotation;
        }
      }
    } else {
      // Edit mode: everything follows its Transform (moved by the gizmo etc).
      for (const [id, s] of this.states) {
        const e = ecs.getById(id);
        if (e) this.followTransform(e, s, false);
      }
    }
  }

  /** Is this character standing on something? */
  /** A 2D game: bodies stay on the flat plane (z = where they started). */
  flat = false;

  isGrounded(entity: Entity): boolean {
    return this.states.get(entity.id)?.grounded ?? false;
  }

  /** What a character is standing on (floor, bridge, terrain), if anything. */
  groundOf(entity: Entity): Entity | undefined {
    const s = this.states.get(entity.id);
    return s?.grounded && s.groundId && this.ecs ? this.ecs.getById(s.groundId) : undefined;
  }

  isClimbing(entity: Entity): boolean {
    return this.states.get(entity.id)?.mode === 'climb';
  }

  isSwimming(entity: Entity): boolean {
    return this.states.get(entity.id)?.mode === 'swim';
  }

  /** Make a non-player character walk in a direction (call every frame; expires quickly). */
  setMoveIntent(entity: Entity, dir: THREE.Vector3, run = false): void {
    const s = this.states.get(entity.id);
    if (s?.kind !== 'character') return;
    // 2D seen from above walks along Y too.
    const topDown = this.flat && !!entity.get(CharacterController)?.topDown;
    s.intent = { dir: new THREE.Vector3(dir.x, topDown ? dir.y : 0, dir.z), run, until: this.simTime + 0.25 };
  }

  /**
   * Carrying: a held dynamic body stops simulating and follows its Transform (which the
   * carrier moves). Releasing makes it fall again from wherever it is.
   */
  setHeld(entity: Entity, held: boolean): void {
    const s = this.states.get(entity.id);
    if (!s || s.kind !== 'dynamic' || !!s.held === held) return;
    s.held = held;
    const R = this.rapier;
    s.body.setBodyType(held ? R.RigidBodyType.KinematicPositionBased : R.RigidBodyType.Dynamic, true);
    if (!held) {
      s.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /**
   * First solid thing along a ray (sensors ignored). `exclude` skips one entity's colliders
   * (e.g. the player, for camera collision).
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number, exclude?: Entity): { distance: number; entity?: Entity } | null {
    this.flush();
    if (!this._simulating) {
      // New colliders only join the query structure during a step. In edit mode every body is
      // kinematic and still, so a quiet step is safe.
      this.world.timestep = 1 / 60;
      this.world.step();
    }
    const d = dir.clone().normalize();
    const ray = new this.rapier.Ray(origin, d);
    const excludeBody = exclude ? this.states.get(exclude.id)?.body : undefined;
    const hit = this.world.castRay(ray, maxDistance, true, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, excludeBody);
    if (!hit) return null;
    const toi = (hit as unknown as { timeOfImpact?: number; toi?: number }).timeOfImpact ?? (hit as unknown as { toi: number }).toi;
    const id = this.colliderOwner.get(hit.collider.handle);
    return { distance: toi, entity: id && this.ecs ? this.ecs.getById(id) : undefined };
  }

  /** Set a dynamic body's velocity (m/s). */
  setVelocity(entity: Entity, v: THREE.Vector3): void {
    this.flush(); // an object spawned this frame gets its body first
    const s = this.states.get(entity.id);
    if (s?.kind === 'dynamic') s.body.setLinvel(v, true);
    else if (s?.kind === 'character') this.launch(s, v, true);
  }

  /** Characters: jump pads, knockback, cannons. Up speed replaces gravity's; sideways speed fades. */
  private launch(s: BodyState, v: THREE.Vector3, replace: boolean): void {
    if (s.mode === 'climb') s.mode = 'walk';
    if (v.y !== 0) s.verticalVelocity = replace ? v.y : s.verticalVelocity + v.y;
    s.grounded = false;
    const side = new THREE.Vector3(v.x, 0, v.z);
    s.momentum = replace || !s.momentum ? side : s.momentum.add(side);
  }

  /**
   * Move a body to wherever its Transform now says (scripts teleporting things, checkpoints).
   * Velocity is cleared so it doesn't keep flying.
   */
  teleport(entity: Entity): void {
    const s = this.states.get(entity.id);
    if (!s) return;
    if (s.kind !== 'dynamic' && s.kind !== 'character') return; // others follow their Transform anyway
    const m = worldMatrixOf(entity);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.decompose(p, q, new THREE.Vector3());
    if (s.kind === 'character' && this._simulating) p.y += CHARACTER_SKIN;
    s.body.setTranslation(p, true);
    s.body.setRotation(q, true);
    if (s.kind === 'dynamic') {
      s.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      s.verticalVelocity = 0;
      s.body.setNextKinematicTranslation(p);
    }
  }

  /** Push a dynamic body (N·s). */
  applyImpulse(entity: Entity, impulse: THREE.Vector3): void {
    this.flush();
    const s = this.states.get(entity.id);
    if (s?.kind === 'dynamic') s.body.applyImpulse(impulse, true);
    // A character counts as about 70 kg… but pushes should feel like they do something.
    else if (s?.kind === 'character') this.launch(s, impulse.clone().multiplyScalar(1 / 7), false);
  }

  /** Line segments of every collider, for the "Show colliders" debug view. */
  debugLines(): { vertices: Float32Array; colors: Float32Array } {
    this.flush();
    return this.world.debugRender();
  }

  /** Number of physics bodies (for tests/debugging). */
  get bodyCount(): number {
    return this.states.size;
  }

  // ── building bodies ──────────────────────────────────────────────────────

  /** A sprite's collider shape (size, circle or box): only a change to that rebuilds its body. */
  private readonly spriteShapes = new Map<string, string>();

  private onComponent(entity: Entity, type: string): void {
    // Transform changes don't rebuild anything: bodies follow (or are teleported) and
    // followTransform() notices scale changes. Rebuilding would lose velocity/held/climb state.
    let spriteResized = false;
    if (type === Sprite.type && needsBody(entity)) {
      const sp = entity.get(Sprite);
      const shape = sp ? `${sp.size[0]},${sp.size[1]},${sp.shape},${!!sp.image}` : '';
      spriteResized = this.spriteShapes.get(entity.id) !== shape;
      this.spriteShapes.set(entity.id, shape);
    }
    if (PHYSICS_TYPES.has(type) || spriteResized || (SHAPE_SOURCES.has(type) && needsBody(entity))) {
      this.dirty.add(entity.id);
    } else if (type === Transform.type && this._simulating) {
      // Someone moved it on purpose (Inspector, script): physics-driven bodies jump there.
      // Our own per-frame write-back edits the data directly, so it never lands here.
      for (const d of entity.descendants(true)) this.teleport(d);
    }
  }

  private flush(): void {
    if (!this.dirty.size || !this.ecs) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      this.remove(id);
      const e = this.ecs.getById(id);
      if (e && e.activeInHierarchy && needsBody(e)) this.build(e);
    }
  }

  private remove(id: string): void {
    const s = this.states.get(id);
    if (!s) return;
    for (const c of s.colliders) this.colliderOwner.delete(c.handle);
    if (s.controller) this.world.removeCharacterController(s.controller);
    this.world.removeRigidBody(s.body);
    this.states.delete(id);
  }

  private build(e: Entity): void {
    const R = this.rapier;
    const world = worldMatrixOf(e);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    world.decompose(pos, quat, scale);
    scale.set(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));

    const cc = e.get(CharacterController);
    if (cc && this._simulating) pos.y += CHARACTER_SKIN + 0.005;
    const rb = e.get(RigidBody);
    const kind: BodyKind = cc ? 'character' : rb ? (rb.type as BodyKind) : 'static';
    // While editing, nothing moves: make every body kinematic so it can be teleported.
    const runtimeKind = this._simulating ? kind : 'kinematic';
    const desc =
      runtimeKind === 'dynamic'
        ? R.RigidBodyDesc.dynamic()
        : runtimeKind === 'static'
          ? R.RigidBodyDesc.fixed()
          : R.RigidBodyDesc.kinematicPositionBased();
    desc.setTranslation(pos.x, pos.y, pos.z).setRotation(quat);
    if (rb && kind === 'dynamic') {
      desc
        .setLinearDamping(rb.linearDamping)
        .setAngularDamping(rb.angularDamping)
        .setGravityScale(rb.gravityScale)
        .setCcdEnabled(rb.continuousCollision);
      if (rb.lockRotation) desc.lockRotations();
      // 2D games: things stay on the flat plane and only spin around the view direction.
      else if (this.flat) desc.enabledRotations(false, false, true);
      if (this.flat) desc.enabledTranslations(true, true, false);
    }
    const body = this.world.createRigidBody(desc);
    const state: BodyState = {
      kind,
      body,
      colliders: [],
      verticalVelocity: 0,
      grounded: false,
      scale,
      waitingForModel: false,
      mode: 'walk',
      climbNormal: new THREE.Vector3(0, 0, 1),
    };
    this.states.set(e.id, state);

    const descs = cc ? [characterCapsule(R, cc, scale)] : this.colliderDescs(e, rb, scale, state);
    // Scattered trees and rocks: one simple solid per thing, in the same body.
    const sc = e.get(Scatter);
    if (sc?.solid && this.options.scatter) {
      for (const c of scatterColliders(sc, this.options.scatter(e))) {
        descs.push(R.ColliderDesc.cylinder((c.height / 2) * scale.y, c.radius * Math.max(scale.x, scale.z)).setTranslation(c.x * scale.x, c.y * scale.y, c.z * scale.z));
      }
    }
    const mass = rb && kind === 'dynamic' ? rb.mass / Math.max(1, descs.length) : 0;
    for (const d of descs) {
      if (mass > 0) d.setMass(mass);
      d.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      if (d.isSensor) d.setActiveCollisionTypes(R.ActiveCollisionTypes.ALL);
      const collider = this.world.createCollider(d, body);
      state.colliders.push(collider);
      this.colliderOwner.set(collider.handle, e.id);
    }

    if (cc) {
      const ctl = this.world.createCharacterController(CHARACTER_SKIN);
      ctl.setUp({ x: 0, y: 1, z: 0 });
      ctl.setMaxSlopeClimbAngle(cc.maxSlope * DEG);
      ctl.setMinSlopeSlideAngle(Math.min(89, cc.maxSlope + 5) * DEG);
      if (cc.stepHeight > 0) ctl.enableAutostep(cc.stepHeight, cc.radius * 0.5, false);
      ctl.enableSnapToGround(Math.max(0.1, cc.stepHeight));
      ctl.setApplyImpulsesToDynamicBodies(true);
      ctl.setCharacterMass(70);
      state.controller = ctl;
    }
  }

  private colliderDescs(
    e: Entity,
    rb: RigidBodyData | undefined,
    scale: THREE.Vector3,
    state: BodyState,
  ): RAPIER_NS.ColliderDesc[] {
    const R = this.rapier;
    // Only scattered things here (no shape of its own): their solids are added separately.
    if (e.has(Scatter) && !e.has(Collider) && !e.has(Terrain)) return [];
    const c: ColliderData = { ...Collider.defaults(), ...(e.get(Collider) ?? {}) };
    const s = scale;
    const maxXZ = Math.max(s.x, s.z);
    const meshShape = e.get(MeshRenderer)?.shape;
    const sprite = e.get(Sprite);
    let shape = c.shape;
    let desc: RAPIER_NS.ColliderDesc | null = null;
    const offset = new THREE.Vector3().fromArray(c.offset).multiply(s);

    // A tilemap: one box per run of painted tiles in a row (a meter deep, like sprites).
    const tilemap = e.get(Tilemap);
    if (tilemap && shape === 'auto') {
      if (!tilemap.solid) return [];
      const t = tilemap.tileSize;
      return solidRuns(tilemap.cells).map((run) =>
        R.ColliderDesc.cuboid(((run.x1 - run.x0 + 1) * t * s.x) / 2, (t * s.y) / 2, 0.5 * s.z)
          .setTranslation(((run.x0 + run.x1 + 1) / 2) * t * s.x + offset.x, (run.y + 0.5) * t * s.y + offset.y, offset.z)
          .setFriction(c.friction)
          .setRestitution(c.bounciness)
          .setSensor(c.isTrigger),
      );
    }

    const terrain = e.get(Terrain);
    if (terrain && shape === 'auto') {
      const hm = this.options.terrain?.(e.id);
      if (!hm) return [];
      // Rapier wants the heights column by column; ours are row by row (rows along Z).
      const n = hm.resolution + 1;
      const heights = new Float32Array(n * n);
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) heights[x * n + z] = hm.data[z * n + x];
      desc = R.ColliderDesc.heightfield(hm.resolution, hm.resolution, heights, { x: terrain.size * s.x, y: terrain.maxHeight * s.y, z: terrain.size * s.z });
    } else if (shape === 'auto' && sprite && !e.get(ModelRenderer)?.model && !meshShape) {
      // A flat sprite: its size across, a meter deep (so 2D things stand on it), or a disc.
      const [w, h] = sprite.size;
      desc =
        sprite.shape === 'circle' && !sprite.image
          ? R.ColliderDesc.ball((Math.min(w * s.x, h * s.y)) / 2)
          : R.ColliderDesc.cuboid((w * s.x) / 2, (h * s.y) / 2, 0.5 * s.z);
    } else if (shape === 'auto') {
      if (e.get(ModelRenderer)?.model) shape = rb?.type === 'dynamic' ? 'convex' : 'mesh';
      else if (meshShape === 'sphere') {
        // A stretched sphere (ellipsoid) needs a hull, or it'd be a ball of the widest size.
        const stretched = Math.max(s.x, s.y, s.z) / Math.min(s.x, s.y, s.z) > 1.05;
        if (stretched) shape = 'convex';
        else desc = R.ColliderDesc.ball(0.5 * s.x);
      }
      else if (meshShape === 'capsule') desc = R.ColliderDesc.capsule(0.5 * s.y, 0.5 * maxXZ);
      else if (meshShape === 'cylinder') desc = R.ColliderDesc.cylinder(0.5 * s.y, 0.5 * maxXZ);
      else if (meshShape === 'cone') desc = R.ColliderDesc.cone(0.5 * s.y, 0.5 * maxXZ);
      else if (meshShape === 'plane') {
        desc = R.ColliderDesc.cuboid(0.5 * s.x, 0.01, 0.5 * s.z);
        offset.y -= 0.01; // top face flush with the visible plane
      } else if (meshShape === 'torus') shape = rb?.type === 'dynamic' ? 'convex' : 'mesh';
      else desc = R.ColliderDesc.cuboid(0.5 * s.x, 0.5 * s.y, 0.5 * s.z);
    }

    if (!desc) {
      switch (shape) {
        case 'box':
          desc = R.ColliderDesc.cuboid((c.size[0] * s.x) / 2, (c.size[1] * s.y) / 2, (c.size[2] * s.z) / 2);
          break;
        case 'sphere':
          desc = R.ColliderDesc.ball(c.radius * Math.max(s.x, s.y, s.z));
          break;
        case 'capsule':
          desc = R.ColliderDesc.capsule(Math.max(0, c.height / 2 - c.radius) * s.y, c.radius * maxXZ);
          break;
        case 'cylinder':
          desc = R.ColliderDesc.cylinder((c.height / 2) * s.y, c.radius * maxXZ);
          break;
        case 'mesh':
        case 'convex': {
          const geo = this.collectGeometry(e, s);
          if (!geo) {
            state.waitingForModel = !!e.get(ModelRenderer)?.model;
            return [];
          }
          desc =
            shape === 'mesh'
              ? R.ColliderDesc.trimesh(geo.vertices, geo.indices)
              : R.ColliderDesc.convexHull(geo.vertices);
          if (!desc) return [];
          offset.set(0, 0, 0); // vertices are already in body space
          break;
        }
      }
    }
    if (!desc) return [];
    desc
      .setTranslation(offset.x, offset.y, offset.z)
      .setFriction(c.friction)
      .setRestitution(c.bounciness)
      .setSensor(c.isTrigger);
    return [desc];
  }

  /** Triangles of every visible mesh under the entity, in the body's (scaled) local space. */
  private collectGeometry(e: Entity, scale: THREE.Vector3): { vertices: Float32Array; indices: Uint32Array } | null {
    const node = this.render?.nodeOf(e);
    if (!node) return null;
    node.updateWorldMatrix(true, true);
    const toNode = node.matrixWorld.clone().invert();
    const scaleM = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
    const verts: number[] = [];
    const idx: number[] = [];
    const v = new THREE.Vector3();
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.editorOnly) return;
      // Don't swallow child entities' meshes — they get their own bodies.
      for (let p: THREE.Object3D | null = mesh; p && p !== node; p = p.parent) {
        if (p.userData.entityId) return;
      }
      const g = mesh.geometry as THREE.BufferGeometry;
      const posAttr = g.getAttribute('position');
      if (!posAttr) return;
      const m = scaleM.clone().multiply(toNode).multiply(mesh.matrixWorld);
      const base = verts.length / 3;
      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(m);
        verts.push(v.x, v.y, v.z);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < posAttr.count; i++) idx.push(base + i);
    });
    if (!verts.length) return null;
    return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
  }

  // ── simulation ───────────────────────────────────────────────────────────

  /** Move a non-dynamic body to wherever its Transform says (teleport or kinematic move). */
  private followTransform(e: Entity, s: BodyState, smooth: boolean): void {
    const m = worldMatrixOf(e);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    m.decompose(p, q, sc);
    sc.set(Math.abs(sc.x), Math.abs(sc.y), Math.abs(sc.z));
    if (!approxEqual(sc, s.scale)) {
      this.dirty.add(e.id);
      return;
    }
    const t = s.body.translation();
    const r = s.body.rotation();
    if (Math.abs(t.x - p.x) + Math.abs(t.y - p.y) + Math.abs(t.z - p.z) < 1e-5 &&
        Math.abs(r.x - q.x) + Math.abs(r.y - q.y) + Math.abs(r.z - q.z) + Math.abs(r.w - q.w) < 1e-6) {
      s.moved = undefined;
      s.turned = undefined;
      return;
    }
    if (smooth) {
      // Remember the motion so characters standing here are carried with it.
      s.moved = new THREE.Vector3(p.x - t.x, p.y - t.y, p.z - t.z);
      s.turned = q.clone().multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
    }
    if (smooth && s.body.isKinematic()) {
      s.body.setNextKinematicTranslation(p);
      s.body.setNextKinematicRotation(q);
    } else {
      s.body.setTranslation(p, true);
      s.body.setRotation(q, true);
    }
  }

  private moveCharacter(e: Entity, s: BodyState, dt: number): void {
    const cc = e.get(CharacterController);
    const ctl = s.controller;
    const collider = s.colliders[0];
    if (!cc || !ctl || !collider) return;
    const ecs = this.ecs;
    if (!ecs) return;

    // ── what the character wants to do ──
    const forward = this.cameraForward();
    const right = new THREE.Vector3().crossVectors(forward, UP);
    const move = new THREE.Vector3();
    let stickY = 0;
    let running = false;
    let jumpWanted = false;
    let jumpHeld = false;
    const input = this.options.input;
    // 2D seen from above: up / down walks along Y, nothing falls.
    const topDown = this.flat && !!cc.topDown;
    if (cc.playerControlled && input) {
      const x = input.axis('moveX');
      stickY = input.axis('moveY');
      running = input.action('run');
      jumpHeld = !topDown && input.action('jump');
      jumpWanted = !topDown && this.jumpBuffer > 0;
      if (topDown) move.set(x, stickY, 0);
      else move.addScaledVector(forward, stickY).addScaledVector(right, x);
    } else if (s.intent && s.intent.until > this.simTime) {
      move.copy(s.intent.dir);
      running = s.intent.run;
      stickY = move.length();
    }
    if (move.lengthSq() > 1) move.normalize();

    const t = s.body.translation();
    const height = cc.height * s.scale.y;
    // The capsule's bottom — the origin may be at the feet (default) or at the middle.
    const feet = new THREE.Vector3(t.x, t.y - CHARACTER_SKIN + cc.center[1] * s.scale.y - height / 2, t.z);
    const radius = cc.radius * Math.max(s.scale.x, s.scale.z);
    const g = GRAVITY * cc.gravity;

    // ── surroundings ──
    const water = topDown ? null : this.waterAt(feet.clone().add(new THREE.Vector3(0, height * 0.55, 0)));
    const climb = topDown ? null : this.climbableNear(feet, height, radius, e);

    // ── choose a mode ──
    if (s.mode === 'climb') {
      if (!climb) {
        // Ran out of wall: if we were going up, pull ourselves over the top.
        if (stickY > 0.2) {
          s.verticalVelocity = 3;
          s.boost = { dir: s.climbNormal.clone().negate(), until: this.simTime + 0.35 };
        }
        s.mode = 'walk';
      } else if (jumpWanted) {
        s.mode = 'walk';
        s.verticalVelocity = Math.sqrt(2 * g * Math.max(0.5, cc.jumpHeight)) * 0.7;
        s.boost = { dir: s.climbNormal.clone(), until: this.simTime + 0.3 };
        this.jumpBuffer = 0;
        s.climbCooldown = this.simTime + 0.4;
      } else if (s.grounded && stickY < -0.2) {
        s.mode = 'walk';
      }
    } else if (climb && stickY > 0.3 && this.simTime > (s.climbCooldown ?? 0) && !water) {
      s.mode = 'climb';
      s.verticalVelocity = 0;
    } else if (water) {
      // Water is probed at chest height, so "found" means chest-deep: swim.
      s.mode = 'swim';
    } else if (s.mode === 'swim') {
      s.mode = 'walk';
    }
    if (climb) s.climbNormal = climb.normal;

    // ── move ──
    const desired = new THREE.Vector3();
    let face: THREE.Vector3 | null = move.lengthSq() > 1e-4 ? move.clone() : null;

    if (s.mode === 'climb' && climb) {
      const speed = climb.speed;
      // Sideways on the wall (2D: left / right on the screen, whichever side the ladder was touched from).
      const along = this.flat ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3().crossVectors(UP, climb.normal).normalize();
      const x = cc.playerControlled && input ? input.axis('moveX') : 0;
      desired
        .addScaledVector(UP, stickY * speed * dt)
        .addScaledVector(along, -x * speed * 0.6 * dt)
        .addScaledVector(climb.normal, -0.6 * dt); // lean in so we stay on the wall
      s.verticalVelocity = 0;
      face = climb.normal.clone().negate();
    } else if (s.mode === 'swim' && water) {
      const target = water.surface - height * 0.62; // chest-deep, head above water
      const spring = (target - feet.y) * 10 * water.buoyancy;
      s.verticalVelocity += (spring - s.verticalVelocity * water.drag) * dt;
      if (jumpHeld) s.verticalVelocity = Math.max(s.verticalVelocity, water.swimSpeed * 0.9);
      // At the surface, a jump lifts us out onto the shore.
      if (jumpWanted && feet.y > target - 0.25) {
        s.verticalVelocity = Math.sqrt(2 * g * Math.max(0.6, cc.jumpHeight * 0.8));
        this.jumpBuffer = 0;
      }
      s.verticalVelocity = THREE.MathUtils.clamp(s.verticalVelocity, -4, 6);
      desired.set(move.x * water.swimSpeed * dt, s.verticalVelocity * dt, move.z * water.swimSpeed * dt);
    } else if (topDown) {
      const speed = running ? cc.runSpeed : cc.speed;
      s.verticalVelocity = 0;
      desired.set(move.x * speed * dt, move.y * speed * dt, 0);
    } else {
      if (s.grounded && s.verticalVelocity < 0) s.verticalVelocity = 0;
      if (s.grounded && jumpWanted && cc.jumpHeight > 0) {
        s.verticalVelocity = Math.sqrt(2 * g * cc.jumpHeight);
        this.jumpBuffer = 0;
      }
      s.verticalVelocity -= g * dt;
      const speed = running ? cc.runSpeed : cc.speed;
      // On ice (a Slippery floor) speed changes slowly, so the character slides.
      const want = new THREE.Vector3(move.x * speed, 0, move.z * speed);
      s.slide ??= want.clone();
      const grip = s.grounded ? (this.groundCollider(s)?.friction ?? 1) : 1;
      if (grip < 0.15) s.slide.lerp(want, 1 - Math.exp(-1.5 * dt));
      else s.slide.copy(want);
      desired.set(s.slide.x * dt, s.verticalVelocity * dt, s.slide.z * dt);
      if (s.boost && s.boost.until > this.simTime) desired.addScaledVector(s.boost.dir, cc.speed * dt);
      if (s.momentum && s.momentum.lengthSq() > 1e-4) {
        desired.addScaledVector(s.momentum, dt);
        // Fades quickly on the ground (friction), slowly in the air.
        s.momentum.multiplyScalar(Math.exp(-(s.grounded ? 8 : 0.6) * dt));
      }
    }

    // Standing on a moving platform: ride along (and around, if it spins).
    let spin: THREE.Quaternion | null = null;
    const platform = s.grounded && s.groundId ? this.states.get(s.groundId) : undefined;
    if (platform && platform.kind !== 'dynamic' && platform.kind !== 'character') {
      if (platform.moved) desired.add(platform.moved);
      if (platform.turned && Math.abs(1 - Math.abs(platform.turned.w)) > 1e-7) {
        const c = platform.body.translation();
        const rel = new THREE.Vector3(t.x - c.x, t.y - c.y, t.z - c.z);
        const around = rel.clone().applyQuaternion(platform.turned).sub(rel);
        desired.add(around);
        spin = platform.turned;
      }
    }

    // Side-view games (and every 2D game): stay on the plane we started on.
    const lockAxis = this.flat && cc.lockAxis === 'none' ? 'z' : cc.lockAxis;
    if (lockAxis === 'z' || lockAxis === 'x') {
      s.lockAt ??= lockAxis === 'z' ? t.z : t.x;
      if (lockAxis === 'z') desired.z = s.lockAt - t.z;
      else desired.x = s.lockAt - t.x;
    }
    ctl.computeColliderMovement(collider, desired, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS);
    const moved = ctl.computedMovement();
    const wasGrounded = s.grounded;
    s.grounded = ctl.computedGrounded();
    this.trackCharacterContacts(e, s, ctl);
    s.groundId = this.groundUnder(ctl);
    // Bumped our head: stop rising.
    if (s.mode === 'walk' && s.verticalVelocity > 0 && moved.y < desired.y * 0.5) s.verticalVelocity = 0;
    // Landing on something Bouncy: back up again (a trampoline).
    const bounce = this.groundCollider(s)?.bounciness ?? 0;
    if (s.mode === 'walk' && !topDown && s.grounded && !wasGrounded && bounce > 0.3 && s.verticalVelocity < -2) {
      const up = -s.verticalVelocity * Math.min(1, bounce);
      if (up > 2) {
        s.verticalVelocity = up;
        s.grounded = false;
      }
    }

    s.body.setNextKinematicTranslation({ x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z });

    if (spin && !(cc.turnSpeed > 0 && face && face.lengthSq() > 1e-4)) {
      // Turn with a spinning platform when not steering ourselves.
      const r = s.body.rotation();
      const yawOnly = new THREE.Euler().setFromQuaternion(spin, 'YXZ');
      const turn = new THREE.Quaternion().setFromAxisAngle(UP, yawOnly.y);
      s.body.setNextKinematicRotation(turn.multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w)));
    }
    // 2D: characters keep facing the camera (their sprite mirrors when they walk left).
    if (cc.turnSpeed > 0 && face && face.lengthSq() > 1e-4 && !this.flat) {
      const target = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(face.x, face.z));
      const r = s.body.rotation();
      const current = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      current.slerp(target, Math.min(1, cc.turnSpeed * dt));
      s.body.setNextKinematicRotation(current);
    }
  }

  /** Flat (XZ) direction the camera looks: "W" walks this way. */
  private cameraForward(): THREE.Vector3 {
    const forward = new THREE.Vector3(0, 0, -1);
    const cam = this.options.camera?.();
    if (cam) {
      cam.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
    }
    return forward;
  }

  /** The water volume containing a point, and where its surface is. */
  private waterAt(point: THREE.Vector3): { surface: number; swimSpeed: number; buoyancy: number; drag: number } | null {
    const ecs = this.ecs;
    if (!ecs) return null;
    let found: { surface: number; swimSpeed: number; buoyancy: number; drag: number } | null = null;
    this.world.intersectionsWithPoint(point, (c) => {
      const owner = this.ownerOf(c, ecs);
      const w = owner?.get(Water);
      if (!w) return true;
      found = { surface: colliderTop(c), swimSpeed: w.swimSpeed, buoyancy: w.buoyancy, drag: w.drag };
      return false;
    });
    return found;
  }

  /** A climbable surface the character is touching (within a hand's reach). */
  private climbableNear(
    feet: THREE.Vector3,
    height: number,
    radius: number,
    self: Entity,
  ): { normal: THREE.Vector3; speed: number } | null {
    const ecs = this.ecs;
    if (!ecs) return null;
    const reach = radius + 0.25;
    const half = Math.max(0.01, height / 2 - radius);
    const center = { x: feet.x, y: feet.y + height / 2, z: feet.z };
    const shape = new this.rapier.Capsule(half, reach);
    let hit: { normal: THREE.Vector3; speed: number } | null = null;
    this.world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
      const owner = this.ownerOf(c, ecs);
      if (!owner || owner === self) return true;
      const climb = owner.get(Climbable);
      if (!climb) return true;
      // Normal pointing from the wall toward the character (flat).
      const p = c.translation();
      const normal = new THREE.Vector3(center.x - p.x, 0, center.z - p.z);
      const closest = c.castRayAndGetNormal?.(
        new this.rapier.Ray(center, { x: -normal.x, y: 0, z: -normal.z }),
        reach + 5,
        true,
      );
      if (closest?.normal) normal.set(closest.normal.x, 0, closest.normal.z);
      if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
      hit = { normal: normal.normalize(), speed: climb.speed };
      return false;
    });
    return hit;
  }

  /** The Collider of what a character stands on (friction, bounciness). */
  private groundCollider(s: BodyState): { friction: number; bounciness: number } | undefined {
    return s.groundId ? this.ecs?.getById(s.groundId)?.get(Collider) : undefined;
  }

  private ownerOf(c: RAPIER_NS.Collider, ecs: World): Entity | undefined {
    const id = this.colliderOwner.get(c.handle);
    return id ? ecs.getById(id) : undefined;
  }

  /** Entity id of the floor the character touched this step (a contact facing up). */
  private groundUnder(ctl: RAPIER_NS.KinematicCharacterController): string | undefined {
    for (let i = 0; i < ctl.numComputedCollisions(); i++) {
      const c = ctl.computedCollision(i);
      if (c?.collider && c.normal1.y > 0.6) return this.colliderOwner.get(c.collider.handle);
    }
    return undefined;
  }

  /** Characters are kinematic, so physics doesn't report their bumps — derive them here. */
  private trackCharacterContacts(e: Entity, s: BodyState, ctl: RAPIER_NS.KinematicCharacterController): void {
    const now = new Set<number>();
    for (let i = 0; i < ctl.numComputedCollisions(); i++) {
      const c = ctl.computedCollision(i);
      if (c?.collider) now.add(c.collider.handle);
    }
    const before = s.touching ?? new Set<number>();
    const ecs = this.ecs;
    if (ecs) {
      const emit = (handle: number, kind: 'collisionEnter' | 'collisionExit') => {
        const id = this.colliderOwner.get(handle);
        const other = id ? ecs.getById(id) : undefined;
        if (other && other !== e) this.events.emit(kind, { a: e, b: other });
      };
      for (const h of now) if (!before.has(h)) emit(h, 'collisionEnter');
      for (const h of before) if (!now.has(h)) emit(h, 'collisionExit');
    }
    s.touching = now;
  }

  private dispatchCollision(h1: number, h2: number, started: boolean): void {
    const ecs = this.ecs;
    const id1 = this.colliderOwner.get(h1);
    const id2 = this.colliderOwner.get(h2);
    if (!ecs || !id1 || !id2) return;
    const a = ecs.getById(id1);
    const b = ecs.getById(id2);
    if (!a || !b) return;
    const c1 = this.world.getCollider(h1);
    const c2 = this.world.getCollider(h2);
    if (c1?.isSensor() || c2?.isSensor()) {
      const [trigger, other] = c1?.isSensor() ? [a, b] : [b, a];
      this.events.emit(started ? 'triggerEnter' : 'triggerExit', { trigger, other });
    } else {
      this.events.emit(started ? 'collisionEnter' : 'collisionExit', { a, b });
    }
  }
}

/** Highest point of a collider (water surface). Uses the box size when it's a box. */
function colliderTop(c: RAPIER_NS.Collider): number {
  const t = c.translation();
  const he = (c as unknown as { halfExtents?: () => { y: number } }).halfExtents?.();
  if (he) return t.y + he.y;
  const r = (c as unknown as { radius?: () => number }).radius?.();
  const hh = (c as unknown as { halfHeight?: () => number }).halfHeight?.();
  return t.y + (hh ?? 0) + (r ?? 0);
}

function needsBody(e: Entity): boolean {
  // Terrain is always solid ground.
  return e.has(Collider) || e.has(RigidBody) || e.has(CharacterController) || e.has(Terrain) || !!e.get(Scatter)?.solid || !!e.get(Tilemap)?.solid;
}

function characterCapsule(R: Rapier, cc: CharacterControllerData, s: THREE.Vector3): RAPIER_NS.ColliderDesc {
  const radius = cc.radius * Math.max(s.x, s.z);
  const half = Math.max(0, (cc.height * s.y) / 2 - radius);
  return R.ColliderDesc.capsule(half, radius)
    .setTranslation(cc.center[0] * s.x, cc.center[1] * s.y, cc.center[2] * s.z)
    .setFriction(0);
}

function approxEqual(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) < 1e-4;
}
