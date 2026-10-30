import * as THREE from 'three';
import { clipEventsOf, eventsCrossed } from './clipEvents';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { Animator, ModelRenderer, type AnimatorData, type ModelRendererData } from '../components/builtin';
import { isRigged, type AssetManager } from '../assets/AssetManager';
import { extractPart } from '../assets/modelParts';
import type { RenderSystem } from './RenderSystem';

interface ModelState {
  assetId: string;
  /** One model out of a pack ('' = the whole file). */
  part: string;
  /** Increments on every (re)load so a slow, stale load can't overwrite a newer one. */
  token: number;
  object?: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  action?: THREE.AnimationAction;
  clipName?: string;
  /** An Animator picks the clips (the ModelRenderer's own clip choice is ignored). */
  animated?: boolean;
  /** In-place copies of clips, by name. */
  inPlace?: Map<string, THREE.AnimationClip>;
  /** The model's own clips, and which model extra clips were borrowed from. */
  ownClips?: THREE.AnimationClip[];
  borrowedFrom?: string;
  /** A clip played once over the movement clips (attack, hurt); `hold` keeps its last frame (defeated). */
  oneShot?: { name: string; action: THREE.AnimationAction; hold: boolean };
  /** Feet on slopes: the foot bones, and how far the body is lowered so the lower foot touches. */
  feet?: THREE.Object3D[] | null;
  footDrop?: number;
  /** Extra turn (radians) an Animator adds so the model faces where it walks. */
  faceYaw?: number;
  data?: ModelRendererData;
  /** The model's own size and pose, measured when it loaded (for fit to height). */
  bounds?: THREE.Box3;
  baseScale?: THREE.Vector3;
  basePosition?: THREE.Vector3;
  baseQuaternion?: THREE.Quaternion;
}

/**
 * Shows ModelRenderer components: loads the model asset, puts a private copy under the entity's
 * node, and plays the chosen animation clip.
 */
export class ModelSystem implements System {
  readonly name = 'models';
  readonly order = 900;
  private readonly states = new Map<string, ModelState>();
  private readonly render: RenderSystem;
  private readonly assets: AssetManager;
  private world: World | null = null;
  private unsubscribers: (() => void)[] = [];
  private nextToken = 1;
  /** Per Animator: where it was last frame and its smoothed speed. */
  private readonly motion = new Map<string, { pos: THREE.Vector3; speed: number; vy: number }>();

  /** Height of whatever is under a point (for feet on slopes); null = nothing there. */
  groundAt: ((x: number, z: number, fromY: number, ignore?: Entity) => number | null) | null = null;
  /** How a character is moving (from physics): walking, swimming or climbing. */
  moveMode: ((e: Entity) => 'walk' | 'swim' | 'climb') | null = null;

  constructor(render: RenderSystem, assets: AssetManager) {
    this.render = render;
    this.assets = assets;
  }

  attach(world: World): void {
    this.world = world;
    const ev = world.events;
    const onComponent = ({ entity, type }: { entity: Entity; type: string }) => {
      if (type === ModelRenderer.type) this.apply(entity);
    };
    this.unsubscribers = [
      ev.on('componentAdded', onComponent),
      ev.on('componentChanged', onComponent),
      ev.on('componentRemoved', onComponent),
      ev.on('entityDestroyed', ({ entity }) => {
        this.clear(entity.id);
        this.motion.delete(entity.id);
      }),
      this.assets.events.on('changed', ({ id }) => {
        // Collect first: apply() deletes and re-adds map entries, and re-adding a key while
        // iterating a Map visits it again — an infinite loop.
        const affected = [...this.states].filter(([, s]) => s.assetId === id).map(([entityId]) => entityId);
        for (const entityId of affected) {
          const s = this.states.get(entityId);
          if (s) s.assetId = ''; // force reload
          const e = world.getById(entityId);
          if (e) this.apply(e);
        }
      }),
    ];
    for (const e of world.query(ModelRenderer)) this.apply(e);
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    for (const id of [...this.states.keys()]) this.clear(id);
    this.world = null;
  }

  update(dt: number): void {
    if (this.world && dt > 0) for (const e of this.world.query(Animator)) this.animate(e, e.get(Animator)!, dt);
    for (const [id, s] of this.states) {
      if (!s.mixer) continue;
      const before = this.onClipEvent && dt > 0 ? this.actionTimes(s) : null;
      s.mixer.update(dt);
      if (before) this.fireClipEvents(id, s, before);
    }
  }

  /** Code points: called when a playing animation reaches one (while the game runs). */
  onClipEvent: ((e: Entity, message: string) => void) | null = null;

  private actionTimes(s: ModelState): Map<THREE.AnimationAction, number> {
    const m = new Map<THREE.AnimationAction, number>();
    for (const a of [s.action, s.oneShot?.action]) if (a?.isRunning()) m.set(a, a.time);
    return m;
  }

  private fireClipEvents(id: string, s: ModelState, before: Map<THREE.AnimationAction, number>): void {
    const e = this.world?.getById(id);
    if (!e) return;
    for (const [action, from] of before) {
      const name = action.getClip().name;
      // In-place / borrowed copies share the original clip's name.
      const events = clipEventsOf(s.clips.find((c) => c.name === name) ?? action.getClip());
      for (const ev of eventsCrossed(events, from, action.time, action.timeScale < 0)) this.onClipEvent?.(e, ev.message);
    }
  }

  /** The model an Animator drives: on its own object, or the first child that has one. */
  private stateFor(entity: Entity): ModelState | undefined {
    const own = this.states.get(entity.id);
    if (own) return own;
    for (const d of entity.descendants(false)) {
      const s = this.states.get(d.id);
      if (s) return s;
    }
    return undefined;
  }

  private animate(e: Entity, a: AnimatorData, dt: number): void {
    const s = this.stateFor(e);
    if (!s?.object) return;
    if ((a.clipsFrom ?? '') !== (s.borrowedFrom ?? '')) this.borrowClips(s, a.clipsFrom ?? '');
    if (!s.mixer) return;
    s.animated = true;
    const node = this.render.nodeOf(e);
    if (!node) return;
    const pos = node.getWorldPosition(new THREE.Vector3());
    let m = this.motion.get(e.id);
    if (!m) {
      m = { pos: pos.clone(), speed: 0, vy: 0 };
      this.motion.set(e.id, m);
    }
    const vx = (pos.x - m.pos.x) / dt;
    const vz = (pos.z - m.pos.z) / dt;
    const vy = (pos.y - m.pos.y) / dt;
    m.pos.copy(pos);
    // Teleports (respawn, editor moves) aren't walking.
    const raw = Math.hypot(vx, vz) > 40 ? 0 : Math.hypot(vx, vz);
    const k = 1 - Math.exp(-dt * 10);
    m.speed += (raw - m.speed) * k;
    m.vy += (Math.abs(vy) > 40 ? 0 : vy - m.vy) * k;

    const pick = (role: AnimatorRole) => autoClip(s.clips, a, role);
    const idle = pick('idle');
    const walk = pick('walk');
    const run = pick('run');
    const jump = pick('jump');
    const mode = this.moveMode?.(e) ?? 'walk';
    const switchToRun = (a.walkSpeed + a.runSpeed) / 2;
    let clip = idle;
    let rate = 1;
    if (mode === 'swim') {
      // Swim when moving, float when still (or swim slowly if there's no floating clip).
      const swim = pick('swim') || walk;
      const still = pick('swimIdle');
      if (m.speed > 0.3 || !still) {
        clip = swim || idle;
        rate = THREE.MathUtils.clamp(Math.max(m.speed, 0.4) / 1.5, 0.4, 1.6);
      } else clip = still;
    } else if (mode === 'climb') {
      // Up plays forward, down backwards; holding on is still (or the climb clip paused).
      const climb = pick('climb');
      const hold = pick('climbIdle');
      if (Math.abs(m.vy) > 0.15 || !hold) {
        clip = climb || hold || idle;
        rate = climb ? THREE.MathUtils.clamp(m.vy / 1.2, -1.6, 1.6) : 1;
        if (Math.abs(m.vy) <= 0.15) rate = 0;
      } else clip = hold;
    } else if (jump && Math.abs(m.vy) > 2.5) clip = jump;
    else if (m.speed > 0.25 && (walk || run)) {
      if (run && (m.speed > switchToRun || !walk)) {
        clip = run;
        rate = m.speed / Math.max(0.1, a.runSpeed);
      } else {
        clip = walk;
        rate = m.speed / Math.max(0.1, a.walkSpeed);
      }
      rate = THREE.MathUtils.clamp(rate, 0.5, 2);
    }
    if (!clip) clip = s.clips[0]?.name ?? '';
    // A one-shot clip (attack, hurt, defeated) plays to its end first.
    if (s.oneShot) {
      if (s.oneShot.hold || s.oneShot.action.isRunning()) return;
      s.oneShot = undefined;
    }
    this.play(s, clip, a.blend, a.inPlace && clip !== idle && mode !== 'climb');
    if (a.feetOnGround !== false) this.groundFeet(e, s, dt, Math.abs(m.vy) > 2 || mode !== 'walk');
    if (a.faceMovement && s.data && s.object.parent && raw > 0.3 && mode !== 'climb') {
      // Models face +Z: turn toward the walking direction, relative to whatever the parent faces.
      const parentYaw = new THREE.Euler().setFromQuaternion(s.object.parent.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      const want = Math.atan2(vx, vz) - parentYaw;
      const cur = s.faceYaw ?? 0;
      const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      s.faceYaw = cur + diff * (1 - Math.exp(-dt * 8));
      this.fit(s, s.data);
    } else if (s.faceYaw && Math.abs(s.faceYaw) > 0.01 && s.data && m.speed < 0.15) {
      // Standing still: face the way the object itself faces (a script may have turned it to look at you).
      s.faceYaw *= Math.exp(-dt * 6);
      this.fit(s, s.data);
    }
    if (s.action) s.action.timeScale = rate;
  }

  /**
   * Feet on slopes: the body stands level on its capsule, so going across a slope one foot
   * floats. Look at the ground under both feet and lower the body until the lower foot touches.
   */
  private groundFeet(e: Entity, s: ModelState, dt: number, inAir: boolean): void {
    if (!this.groundAt || !s.object || !s.data) return;
    if (s.feet === undefined) {
      const found: THREE.Object3D[] = [];
      s.object.traverse((o) => {
        if ((o as THREE.Bone).isBone && /^(left|right)foot$/.test(boneKey(o.name))) found.push(o);
      });
      s.feet = found.length === 2 ? found : null;
    }
    let want = 0;
    if (s.feet && !inAir) {
      const node = this.render.nodeOf(e);
      const origin = node?.getWorldPosition(new THREE.Vector3());
      if (origin) {
        const lows: number[] = [];
        for (const f of s.feet) {
          const p = f.getWorldPosition(new THREE.Vector3());
          const g = this.groundAt(p.x, p.z, origin.y + 0.6, e);
          if (g !== null) lows.push(g);
        }
        if (lows.length === 2) want = THREE.MathUtils.clamp(origin.y - Math.min(...lows), 0, 0.4);
      }
    }
    const cur = s.footDrop ?? 0;
    let next = cur + (want - cur) * (1 - Math.exp(-dt * 12));
    if (Math.abs(want - next) < 0.003) next = want; // settle exactly
    if (next === cur) return;
    s.footDrop = next;
    this.fit(s, s.data);
  }

  /** Add another model's clips (retargeted onto this skeleton by bone names). */
  private borrowClips(s: ModelState, from: string): void {
    s.borrowedFrom = from;
    s.ownClips ??= s.clips;
    s.clips = s.ownClips;
    if (!from) return;
    void this.assets.loadModel(from).then(
      (m) => {
        if (s.borrowedFrom !== from || !s.object) return;
        const extra = retargetClips(m.animations, s.object);
        if (!extra.length) {
          console.warn(`[EGE] None of the animations in that model fit this skeleton (bone names don't match).`);
          return;
        }
        s.clips = [...s.ownClips!, ...extra];
        s.mixer ??= new THREE.AnimationMixer(s.object);
      },
      (err: unknown) => console.error('[EGE] Borrowed animations failed to load:', err instanceof Error ? err.message : err),
    );
  }

  private play(s: ModelState, name: string, blend: number, inPlace: boolean): void {
    if (!s.mixer || !name || (s.clipName === name && s.action)) return;
    let clip = s.clips.find((c) => c.name === name);
    if (!clip) return;
    if (inPlace) {
      s.inPlace ??= new Map();
      let copy = s.inPlace.get(name);
      if (!copy) {
        copy = inPlaceClip(clip);
        s.inPlace.set(name, copy);
      }
      clip = copy;
    }
    const next = s.mixer.clipAction(clip);
    next.reset().play();
    if (s.action && s.action !== next) next.crossFadeFrom(s.action, blend, false);
    s.action = next;
    s.clipName = name;
  }

  /**
   * Play a clip once on this object's model: an Animator role ("attack", "hurt", "die") or any
   * clip name. Movement clips take over again after it (except "die", which stays down).
   * False if there's no animated model (or no such clip).
   */
  playOnce(entity: Entity, what: string): boolean {
    const s = this.stateFor(entity);
    if (!s?.mixer || !s.clips.length) return false;
    const a = entity.get(Animator) ?? [...entity.descendants(false)].find((d) => d.has(Animator))?.get(Animator);
    const role = what.toLowerCase();
    const words: Record<string, string[]> = { attack: ['attack', 'punch', 'slash', 'swing', 'shoot', 'fire'], hurt: ['hurt', 'hit', 'damage', 'react'], die: ['die', 'death', 'dead', 'defeat'], jump: ['jump'] };
    const chosen = (a && role in words ? (a as unknown as Record<string, string>)[role] : '') || (words[role] ? findClip(s.clips, words[role]) : '') || s.clips.find((c) => c.name.toLowerCase() === role)?.name || '';
    const clip = s.clips.find((c) => c.name === chosen);
    if (!clip) return false;
    const next = s.mixer.clipAction(clip);
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.play();
    if (s.action && s.action !== next) next.crossFadeFrom(s.action, 0.15, false);
    s.action = next;
    s.clipName = clip.name;
    s.oneShot = { name: clip.name, action: next, hold: role === 'die' };
    return true;
  }

  /** Clip names of the model on this entity, or on its first child with a model (empty until loaded). */
  clipsOf(entity: Entity): string[] {
    return this.stateFor(entity)?.clips.map((c) => c.name) ?? [];
  }

  /** The loaded model object (for bounds/picking), if any. */
  /** Loaded models that never animate (no clips): what instancing may draw together. */
  stillModels(): { entityId: string; assetId: string; object: THREE.Object3D }[] {
    const out: { entityId: string; assetId: string; object: THREE.Object3D }[] = [];
    for (const [entityId, s] of this.states) if (s.object && !s.clips.length && !s.mixer) out.push({ entityId, assetId: s.assetId, object: s.object });
    return out;
  }

  objectOf(entity: Entity): THREE.Object3D | undefined {
    return this.states.get(entity.id)?.object;
  }

  private apply(entity: Entity): void {
    const data = entity.get(ModelRenderer);
    if (!data || !data.model) {
      this.clear(entity.id);
      return;
    }
    const part = data.part ?? '';
    const state = this.states.get(entity.id);
    if (state && state.assetId === data.model && state.part === part) {
      this.configure(state, data);
      return;
    }
    this.clear(entity.id);
    const token = this.nextToken++;
    const fresh: ModelState = { assetId: data.model, part, token, clips: [] };
    this.states.set(entity.id, fresh);

    this.assets
      .instantiate(data.model)
      .then(({ object: whole, animations }) => {
        const current = this.states.get(entity.id);
        const node = this.render.nodeOf(entity);
        if (current?.token !== token || !node || !this.world) return; // superseded or removed
        const piece = part ? extractPart(whole, part) : null;
        if (part && !piece) console.warn(`[EGE] "${entity.name}": the model has no part "${part}" any more, showing all of it.`);
        const object = piece ?? whole;
        current.object = object;
        current.clips = animations;
        if (animations.length) current.mixer = new THREE.AnimationMixer(object);
        // Measure once (at its own size) so "fit to height" can be applied any time.
        current.bounds = measure(object, current.mixer, animations);
        current.baseScale = object.scale.clone();
        current.basePosition = object.position.clone();
        current.baseQuaternion = object.quaternion.clone();
        node.add(object);
        const latest = entity.get(ModelRenderer);
        if (latest) this.configure(current, latest);
        // Let the editor refresh clip dropdowns etc.
        this.world.events.emit('entityVisualsChanged', { entity });
      })
      .catch((err: unknown) => {
        if (this.states.get(entity.id)?.token !== token) return;
        console.error(`[EGE] Model for "${entity.name}" failed to load:`, err instanceof Error ? err.message : err);
      });
  }

  /**
   * Fit to height, stand on the ground, turn — applied on top of the model's own pose:
   * scale by k, turn by R, then (optionally) move its bottom-centre to the origin.
   */
  private fit(s: ModelState, data: ModelRendererData): void {
    const o = s.object;
    if (!o || !s.bounds || s.bounds.isEmpty() || !s.baseScale || !s.basePosition || !s.baseQuaternion) return;
    const b = s.bounds;
    const height = b.max.y - b.min.y;
    const k = data.fitHeight > 0 && height > 1e-6 ? data.fitHeight / height : 1;
    const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((data.turn || 0) * Math.PI) / 180 + (s.faceYaw ?? 0));
    o.quaternion.copy(R).multiply(s.baseQuaternion);
    o.scale.copy(s.baseScale).multiplyScalar(k);
    const shift = new THREE.Vector3();
    if (data.standOnGround) {
      const c = b.getCenter(new THREE.Vector3());
      c.y = b.min.y;
      shift.copy(c).multiplyScalar(k).applyQuaternion(R).negate();
    }
    o.position.copy(s.basePosition).multiplyScalar(k).applyQuaternion(R).add(shift);
    o.position.y -= s.footDrop ?? 0;
    o.updateMatrixWorld(true);
  }

  private configure(s: ModelState, data: ModelRendererData): void {
    s.data = data;
    this.fit(s, data);
    s.object?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = data.castShadow;
      m.receiveShadow = data.receiveShadow;
    });
    if (!s.mixer) return;
    s.mixer.timeScale = data.animationSpeed;
    if (s.animated) return;
    // Default to the first clip so animated models move as soon as they're dropped in.
    const wanted = data.animation || s.clips[0]?.name || '';
    if (!data.playAnimation || !wanted) {
      s.action?.stop();
      s.action = undefined;
      s.clipName = undefined;
      return;
    }
    if (s.clipName === wanted && s.action) return;
    const clip = s.clips.find((c) => c.name === wanted);
    if (!clip) return;
    const next = s.mixer.clipAction(clip);
    next.reset().play();
    if (s.action && s.action !== next) next.crossFadeFrom(s.action, 0.25, false);
    s.action = next;
    s.clipName = wanted;
  }

  private clear(entityId: string): void {
    const s = this.states.get(entityId);
    if (!s) return;
    s.mixer?.stopAllAction();
    if (s.object) {
      s.object.removeFromParent();
      // Geometry/materials are shared with the cached template; only the clone's skeletons are ours.
      s.object.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.dispose());
    }
    this.states.delete(entityId);
  }
}

/** The best clip for a word: "walk" beats "walk_left"; sideways, backwards and weapon variants come last. */
export type AnimatorRole = 'idle' | 'walk' | 'run' | 'jump' | 'swim' | 'swimIdle' | 'climb' | 'climbIdle';

/** Words that find each Animator slot's clip by name when it's left on Auto. */
export const ROLE_WORDS: Record<AnimatorRole, string[]> = {
  idle: ['idle', 'stand', 'breath'],
  walk: ['walk'],
  run: ['run', 'jog', 'sprint'],
  jump: ['air', 'fall', 'jump'],
  swim: ['swim_fwd', 'swim fwd', 'swim forward', 'swimming', 'swim'],
  swimIdle: ['swim_idle', 'swim idle', 'tread', 'float'],
  climb: ['climb ladder', 'climb_ladder', 'ladder climb', 'climbing', 'climb wall', 'climb'],
  climbIdle: ['ladder_idle', 'ladder idle', 'climb idle', 'hang'],
};

/** The clip an Animator slot plays: the one chosen in the Inspector, or found by name. */
export function autoClip(clips: THREE.AnimationClip[], a: Partial<Record<AnimatorRole, string>>, role: AnimatorRole): string {
  const chosen = a[role];
  if (chosen) return chosen;
  // "idle" / "walk" shouldn't pick the swimming or ladder versions.
  const usable = role === 'idle' || role === 'walk' || role === 'run' ? clips.filter((c) => !/swim|ladder|climb|hang/i.test(c.name)) : clips;
  return findClip(usable, ROLE_WORDS[role]);
}

export function findClip(clips: THREE.AnimationClip[], words: string[]): string {
  let best = '';
  let bestScore = 0;
  for (const c of clips) {
    const n = c.name.toLowerCase().split('|').pop()!.trim();
    for (const [wi, w] of words.entries()) {
      if (!n.includes(w)) continue;
      let score = (n === w ? 30 : n.startsWith(w) ? 20 : 10) - wi;
      if (/left|right|back|strafe|pistol|rifle|gun|sword|tired|injur|wound|crouch|aim/.test(n)) score -= 8;
      if (score > bestScore) {
        bestScore = score;
        best = c.name;
      }
    }
  }
  return best;
}

/** A copy of a clip that walks on the spot: the root bone's steady forward drift is taken out (its sway stays). */
export function inPlaceClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const copy = clip.clone();
  // The root is the bone that travels furthest over the clip (usually hips / root).
  let root: THREE.KeyframeTrack | undefined;
  let most = 0;
  for (const t of copy.tracks) {
    if (!t.name.endsWith('.position') || t.values.length < 6) continue;
    const v = t.values;
    const last = v.length - 3;
    // 3D: some rigs (Mixamo) are turned, so "forward" can be any axis of the bone's space.
    const travel = Math.hypot(v[last] - v[0], v[last + 1] - v[1], v[last + 2] - v[2]);
    if (travel > most) {
      most = travel;
      root = t;
    }
  }
  if (!root || most < 1e-3) return copy;
  const v = root.values;
  const times = root.times;
  const last = v.length - 3;
  const span = times[times.length - 1] - times[0] || 1;
  const d = [v[last] - v[0], v[last + 1] - v[1], v[last + 2] - v[2]];
  for (let i = 0, k = 0; i < v.length; i += 3, k++) {
    const f = (times[k] - times[0]) / span;
    for (let c = 0; c < 3; c++) v[i + c] -= d[c] * f;
  }
  return copy;
}

/**
 * The model's box as it will really be seen. Rigged models are drawn by their skeleton, and
 * many clips move the hips far from the raw mesh (feet a meter under the ground), so they are
 * measured in the first frame of their standing clip.
 */
function measure(object: THREE.Object3D, mixer: THREE.AnimationMixer | undefined, clips: THREE.AnimationClip[]): THREE.Box3 {
  const rigged = isRigged(object);
  let pose: THREE.AnimationAction | null = null;
  if (rigged && mixer && clips.length) {
    const name = findClip(clips, ['idle', 'stand', 'breath']) || clips[0].name;
    pose = mixer.clipAction(clips.find((c) => c.name === name)!);
    pose.play();
    mixer.update(0);
  }
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object, rigged);
  if (pose) {
    pose.stop();
    mixer!.uncacheAction(pose.getClip());
  }
  return box;
}

/** A bone name reduced to what it means: "mixamorig:LeftUpLeg", "upper_leg_L_Rig" and "Thigh.L" all become "leftupperleg". */
export function boneKey(name: string): string {
  // Sketchfab numbers every node ("mixamorigLeftArm_09"): that number isn't part of the bone's name.
  let n = name.toLowerCase().replace(/^.*[:|]/, '').replace(/([a-z0-9])_\d+$/, '$1').replace(/^mixamorig[_.\-\s]*/, '').replace(/^(bip0?1|def|org|armature|rig)[_.\-\s]+/, '').replace(/[_.\-\s]*(rig|jnt|bone)$/g, '');
  // Side: a "l"/"r" or "left"/"right" anywhere becomes a "left"/"right" prefix.
  let side = '';
  const sideMatch = /(^|[_.\-\s])(l|r|left|right)([_.\-\s]|$)|^(left|right)|(left|right)$/.exec(n);
  if (sideMatch) {
    const word = (sideMatch[2] || sideMatch[4] || sideMatch[5])!;
    side = word.startsWith('l') ? 'left' : 'right';
    n = n.slice(0, sideMatch.index) + ' ' + n.slice(sideMatch.index + sideMatch[0].length);
  }
  // Keep numbers (spine, spine1, spine2 are different bones); "spine.001" is "spine1".
  n = n.replace(/[_.\-\s]+/g, '').replace(/0+(\d)/g, '$1');
  const synonyms: [RegExp, string][] = [
    [/^(upleg|upperleg|thigh)$/, 'upperleg'],
    [/^(leg|lowerleg|calf|shin|knee)$/, 'lowerleg'],
    [/^(foot|feet|ankle)$/, 'foot'],
    [/^(toebase|toe|toes)$/, 'toes'],
    [/^(arm|upperarm)$/, 'upperarm'],
    [/^(forearm|lowerarm)$/, 'lowerarm'],
    [/^(shoulder|clavicle|collar)$/, 'shoulder'],
    [/^(hips|pelvis|root)$/, 'hips'],
  ];
  for (const [re, to] of synonyms) if (re.test(n)) n = to;
  return side + n;
}

/**
 * Another model's clips on this model's skeleton: tracks follow the bones with the same meaning.
 * Rotations carry over; only the hips keep their movement (scaled to this character's size).
 * Works best between rigs of the same family (Mixamo to Mixamo).
 */
export function retargetClips(clips: THREE.AnimationClip[], target: THREE.Object3D): THREE.AnimationClip[] {
  const bones = new Map<string, THREE.Object3D>();
  target.traverse((o) => {
    if ((o as THREE.Bone).isBone && !bones.has(boneKey(o.name))) bones.set(boneKey(o.name), o);
  });
  if (!bones.size) return [];
  const out: THREE.AnimationClip[] = [];
  for (const clip of clips) {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf('.');
      const bone = bones.get(boneKey(t.name.slice(0, dot)));
      const prop = t.name.slice(dot + 1);
      if (!bone) continue;
      if (prop === 'quaternion') {
        const copy = t.clone();
        copy.name = `${bone.name}.quaternion`;
        tracks.push(copy);
      } else if (prop === 'position' && boneKey(bone.name) === 'hips') {
        // Hips height differs between characters: scale the movement to ours.
        const copy = t.clone();
        copy.name = `${bone.name}.position`;
        const firstY = t.values[1] || 1;
        const k = bone.position.y && firstY ? bone.position.y / firstY : 1;
        for (let i = 0; i < copy.values.length; i++) copy.values[i] *= k;
        tracks.push(copy);
      }
    }
    if (tracks.length) out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return out;
}
