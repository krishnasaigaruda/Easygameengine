import * as THREE from 'three';
import type { SaveData, SaveStore } from './saveGame';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { EventBus } from '../core/EventBus';
import { MeshRenderer, ModelRenderer, Transform } from '../components/builtin';
import { Sprite } from '../components/sprite';
import { Script, Traits } from '../components/scripting';
import { CharacterController, Collider } from '../components/physics';
import { getComponentDef, type FieldSpec, type Vec3 } from '../core/Component';
import type { AssetManager } from '../assets/AssetManager';
import type { PhysicsSystem } from '../physics/PhysicsSystem';
import type { Input } from '../input/Input';
import type { Hud, HudSlot } from '../ui/Hud';
import { HUD_SLOTS } from '../ui/Hud';
import { instantiateEntity, serializeEntity } from '../scene/serialize';
import { worldMatrixOf } from '../core/transformMath';
import { display, evaluate, parseExpr, safeMember, truthy, type Expr, type ExprScope } from './expr';
import { compileScript, type Action, type CompiledScript, type NearHandler, type Target, type TextTemplate, type TimerHandler } from './compile';
import { ACTION_BY_KEY, INPUT_ACTIONS, didYouMean, keyBinding } from './spec';
import { COMING_SOON_TRAITS, READY_TRAITS, TRAIT_BY_NAME } from './traits';

/** Max actions a script may run in one frame without waiting (catches endless loops). */
const STEP_BUDGET = 20_000;
const FOREVER = Number.POSITIVE_INFINITY;

export interface ScriptLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  entityId?: string;
}

export interface ScriptEvents {
  log: ScriptLog;
}

export interface ScriptHost {
  assets?: AssetManager;
  /** Plays Audio Sources. */
  audio?: { play(e: Entity): void | Promise<void>; stop(e: Entity): void; playMusic?(e: Entity): void | Promise<void>; stopMusic?(fade?: number): void };
  /** Particle bursts. */
  effects?: { burst(e: Entity): void };
  physics?: PhysicsSystem;
  input?: Input;
  hud?: Hud;
  /** Which entity is under a screen point (for on.click). */
  pick?: (clientX: number, clientY: number) => Entity | undefined;
  /** The camera the game is seen through (for camera.forward, lookTarget()). */
  camera?: () => THREE.Camera | undefined;
  /** Weapon components: { fire: "self" }, { reload: "self" }. */
  weapons?: { fire(e: Entity): void; reload(e: Entity): void };
  /** Play a clip once (an Animator role like "attack", or a clip name). False: not animated. */
  animate?: (e: Entity, what: string) => boolean;
  /** Keyframes: "play", "stop", "restart", "reverse". */
  keyframes?: (e: Entity, command: string) => boolean;
  /** Pause / restart the whole game (menus). */
  game?: { pause(on: boolean): void; restart(): void; paused(): boolean };
  /** Saved-game slots ({ save: "'slot1'" }, { load: … }). */
  saves?: SaveStore;
  /** 2D pictures: which way they face (lookAt, carrying). */
  sprites?: { setFacing(entityId: string, left: boolean): void; facingLeft(entityId: string): boolean };
}

class ScriptError extends Error {}

/** Saves keep object references as their id. */
function saveReplacer(_key: string, value: unknown): unknown {
  if (value instanceof EntityRef) return { $entity: value.entity.id };
  if (value instanceof ComponentRef) return null;
  return value;
}

/** Handle for an entity inside expressions (self, other, player…). */
export class EntityRef {
  readonly entity: Entity;
  constructor(entity: Entity) {
    this.entity = entity;
  }
  get name(): string {
    return this.entity.name;
  }
}
/** One component of an object, reached from code: Crosshair.UIPanel, self.Light, Sun.Light.intensity. */
export class ComponentRef {
  readonly entity: Entity;
  readonly type: string;
  constructor(entity: Entity, type: string) {
    this.entity = entity;
    this.type = type;
  }
  get name(): string {
    return `${this.type} of ${this.entity.name}`;
  }
}
class GameRef {}
class TimeRef {}
class InputRef {}
class CameraRef {}

interface Source {
  script: CompiledScript;
  label: string;
}

interface Instance {
  entity: Entity;
  sources: Source[];
  functions: Map<string, { actions: Action[]; label: string }>;
  timers: { handler: TimerHandler; label: string; next: number; done: boolean }[];
  near: { handler: NearHandler; label: string; inside: boolean }[];
}

interface Ctx {
  self: Entity;
  other: Entity | null;
  args: Record<string, unknown>;
  index: number;
  label: string;
  steps: { n: number };
}

type Flow = 'done' | 'stop';

interface Coroutine {
  gen: Generator<number, Flow, void>;
  wakeAt: number;
  entityId: string;
  ctx: Ctx;
}

const BUILTIN_TRAIT_SCRIPTS = new Map<string, CompiledScript>();
/** A trait's script (its 2D version in a 2D game, when it has one). */
export function traitScript(name: string, flat = false): CompiledScript | undefined {
  const def = TRAIT_BY_NAME.get(name);
  const source = (flat && def?.script2D) || def?.script;
  if (!source) return undefined;
  const key = source === def?.script ? name : `${name}:2d`;
  let s = BUILTIN_TRAIT_SCRIPTS.get(key);
  if (!s) {
    s = compileScript(source, `trait "${name}"`, { traits: READY_TRAITS, comingSoonTraits: COMING_SOON_TRAITS });
    if (!s.ok) throw new Error(`Built-in trait "${key}" has errors: ${s.diagnostics.map((d) => d.message).join('; ')}`);
    BUILTIN_TRAIT_SCRIPTS.set(key, s);
  }
  return s;
}

/**
 * Runs EasyScript while the game is playing: traits + Script components, events, timers,
 * coroutines (wait / smooth moves), messages and functions between objects.
 */
export class ScriptSystem implements System {
  readonly name = 'scripts';
  readonly order = 600;
  readonly events = new EventBus<ScriptEvents>();
  /** game.* values (score, checkpoint…). Reset on every Play. */
  game: Record<string, unknown> = {};
  /** What game.* starts as each time the game starts (e.g. game.title). */
  gameDefaults: Record<string, unknown> = {};
  private readonly host: ScriptHost;
  private world: World | null = null;
  private running = false;
  private ready = false;
  private token = 0;
  private elapsed = 0;
  private delta = 0;
  private readonly instances = new Map<string, Instance>();
  private readonly vars = new Map<string, Record<string, unknown>>();
  /** Objects in the scene when the game started (to know which are gone, for saves). */
  private startIds = new Set<string>();
  private coroutines: Coroutine[] = [];
  private readonly compiled = new Map<string, Promise<CompiledScript>>();
  private readonly pendingContacts: { kind: 'touch' | 'untouch'; a: Entity; b: Entity }[] = [];
  private readonly warnedOnce = new Set<string>();
  /** Carried object id → carrier id. */
  private readonly carried = new Map<string, string>();
  private unsubscribers: (() => void)[] = [];
  /** Scripts that finished compiling (looked up without waiting). */
  private readonly compiledNow = new Map<string, CompiledScript>();
  private gameRef = new GameRef();
  private timeRef = new TimeRef();
  private inputRef = new InputRef();
  private cameraRef = new CameraRef();

  constructor(host: ScriptHost = {}) {
    this.host = host;
  }

  /** A 2D game: things stay on the flat plane and face left or right. */
  private get flat(): boolean {
    return !!this.host.physics?.flat;
  }

  get isRunning(): boolean {
    return this.running;
  }

  attach(world: World): void {
    this.world = world;
    const ev = world.events;
    const onComponent = ({ entity, type }: { entity: Entity; type: string }) => {
      if (!this.running || !this.ready) return;
      if (type === Script.type || type === Traits.type) void this.rebuild(entity, false);
    };
    this.unsubscribers = [
      ev.on('componentAdded', onComponent),
      ev.on('componentChanged', onComponent),
      ev.on('componentRemoved', onComponent),
      ev.on('entityDestroyed', ({ entity }) => this.forget(entity.id)),
    ];
    const physics = this.host.physics;
    if (physics) {
      this.unsubscribers.push(
        physics.events.on('collisionEnter', ({ a, b }) => this.pendingContacts.push({ kind: 'touch', a, b })),
        physics.events.on('collisionExit', ({ a, b }) => this.pendingContacts.push({ kind: 'untouch', a, b })),
        physics.events.on('triggerEnter', ({ trigger, other }) => this.pendingContacts.push({ kind: 'touch', a: trigger, b: other })),
        physics.events.on('triggerExit', ({ trigger, other }) => this.pendingContacts.push({ kind: 'untouch', a: trigger, b: other })),
      );
    }
    if (this.host.assets) {
      this.unsubscribers.push(this.host.assets.events.on('changed', ({ id }) => void this.hotReload(id)));
    }
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.stopAll();
    this.world = null;
  }

  /** Start/stop running scripts (Play / Stop). */
  setRunning(on: boolean): Promise<void> {
    if (on === this.running) return Promise.resolve();
    this.running = on;
    this.stopAll();
    if (!on) return Promise.resolve();
    return this.prepare(++this.token);
  }

  /** Compile a script from text (used by the editor for live error checking). */
  static check(source: string, name = 'script'): CompiledScript {
    return compileScript(source, name, { traits: READY_TRAITS, comingSoonTraits: COMING_SOON_TRAITS });
  }

  /** A variable of an entity (for the editor's live Inspector / tests). */
  getVar(entity: Entity, name: string): unknown {
    return this.vars.get(entity.id)?.[name];
  }

  /** All variables of an entity while playing (copy). */
  varsSnapshot(entity: Entity): Record<string, unknown> {
    return { ...(this.vars.get(entity.id) ?? {}) };
  }

  /** Change a variable while playing (live Inspector). */
  setVar(entity: Entity, name: string, value: unknown): void {
    if (['__proto__', 'prototype', 'constructor'].includes(name)) return;
    this.varsOf(entity)[name] = value;
  }

  /** Change a game.* value while playing (live Inspector). */
  setGameValue(name: string, value: unknown): void {
    if (['__proto__', 'prototype', 'constructor'].includes(name)) return;
    this.game[name] = value;
  }

  /** "Score: {game.score}" → "Score: 3", as seen from `entity` (self). For UI text. */
  formatText(template: string, entity: Entity): string {
    return template.replace(/\{([^{}]+)\}/g, (_, src: string) => {
      try {
        const v = this.eval(parseExpr(src), this.ctx(entity, null, `${entity.name} › UI`));
        // While editing, values that only exist in a running game show as "…".
        if (!this.running && (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v)))) return '…';
        return display(v);
      } catch {
        return this.running ? '?' : '…';
      }
    });
  }

  /** Evaluate a formula to an object (an object, or an object's name), or null. */
  evaluateEntity(formula: string, entity: Entity): Entity | null {
    try {
      const v = this.eval(parseExpr(formula), this.ctx(entity, null, `${entity.name} › UI`));
      if (v instanceof EntityRef) return v.entity;
      if (typeof v === 'string' && v) return this.world?.findByName(v) ?? null;
    } catch {
      // not an object
    }
    return null;
  }

  /** Evaluate a formula to a number as seen from `entity` (progress bars). */
  evaluateNumber(formula: string, entity: Entity): number {
    try {
      return Number(this.eval(parseExpr(formula), this.ctx(entity, null, `${entity.name} › UI`))) || 0;
    } catch {
      return 0;
    }
  }

  /** A UI button was clicked: run its on.click, and send its message if it has one. */
  clickUI(entity: Entity, message = ''): void {
    if (!this.running || !this.ready) return;
    this.fire(entity, 'click', null);
    if (!message) return;
    for (const inst of [...this.instances.values()]) {
      for (const src of inst.sources) {
        const list = src.script.messages[message];
        if (list?.length) this.start(list, this.ctx(inst.entity, entity, src.label));
      }
    }
  }

  /** Give an object a message (and the objects it's inside: a character's model is often a child). */
  deliver(entity: Entity, message: string): void {
    if (!this.running || !this.ready) return;
    for (let e: Entity | null = entity; e; e = e.parent) {
      const inst = this.instances.get(e.id);
      if (!inst) continue;
      for (const src of inst.sources) {
        const list = src.script.messages[message];
        if (list?.length) this.start(list, this.ctx(e, entity, src.label));
      }
    }
  }

  /** Everything a saved game keeps (see saveGame.ts). */
  captureSave(): SaveData {
    const objects: SaveData['objects'] = {};
    const alive = new Set<string>();
    for (const e of this.world?.all() ?? []) {
      alive.add(e.id);
      const t = e.get(Transform);
      if (!t) continue;
      const vars = this.vars.get(e.id);
      objects[e.id] = { position: [...t.position], rotation: [...t.rotation], scale: [...t.scale], enabled: e.enabled, ...(vars && Object.keys(vars).length ? { vars: { ...vars } } : {}) };
    }
    return { format: 'ege-save', version: 1, savedAt: Date.now(), game: { ...this.game }, objects, gone: [...this.startIds].filter((id) => !alive.has(id)) };
  }

  /** Put the game back the way a save found it. */
  applySave(data: SaveData): void {
    const world = this.world;
    if (!world || data?.format !== 'ege-save') return;
    const revive = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(revive);
      if (v && typeof v === 'object') {
        const ref = (v as { $entity?: string }).$entity;
        if (ref !== undefined) {
          const e = world.getById(ref);
          return e ? new EntityRef(e) : null;
        }
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
      }
      return v;
    };
    for (const id of data.gone ?? []) {
      const e = world.getById(id);
      if (e) world.destroyEntity(e);
    }
    for (const [id, o] of Object.entries(data.objects ?? {})) {
      const e = world.getById(id);
      if (!e) continue;
      if (e.has(Transform)) e.set(Transform, { position: o.position as Vec3, rotation: o.rotation as Vec3, scale: o.scale as Vec3 });
      e.enabled = o.enabled;
      if (o.vars) Object.assign(this.varsOf(e), revive(o.vars) as Record<string, unknown>);
    }
    this.game = revive(data.game ?? {}) as Record<string, unknown>;
  }

  /** Every key name the running scripts react to (on.key): "c", "space", "jump"… */
  usedKeys(): string[] {
    const keys = new Set<string>();
    for (const inst of this.instances.values()) for (const src of inst.sources) for (const k of Object.keys(src.script.keys)) keys.add(k.toLowerCase());
    return [...keys];
  }

  /** Does any running script react to one of these keys (e.g. "escape", "pause")? */
  listensFor(keys: string[]): boolean {
    for (const inst of this.instances.values()) for (const src of inst.sources) if (keys.some((k) => src.script.keys[k])) return true;
    return false;
  }

  /** Does this entity run any scripts/traits right now? */
  isScripted(entity: Entity): boolean {
    return this.instances.has(entity.id);
  }

  update(dt: number): void {
    // dt 0 = paused: nothing advances, and key presses aren't consumed.
    if (!this.running || !this.ready || !this.world || dt <= 0) return;
    this.delta = dt;
    this.elapsed += dt;

    // Physics contacts collected during the fixed steps.
    for (const c of this.pendingContacts.splice(0)) {
      if (!this.world.getById(c.a.id) || !this.world.getById(c.b.id)) continue;
      this.fire(c.a, c.kind, c.b);
      this.fire(c.b, c.kind, c.a);
    }

    // Resume waiting coroutines.
    for (const co of [...this.coroutines]) if (co.wakeAt <= this.elapsed) this.step(co);
    this.updateCarried();
    this.updateInteraction();

    const input = this.host.input;
    if (input?.wasPressed('Mouse:0') && this.host.pick) {
      const hit = this.host.pick(input.pointer.x, input.pointer.y);
      if (hit) this.fire(hit, 'click', null);
    }

    for (const inst of [...this.instances.values()]) {
      if (!this.world.getById(inst.entity.id) || !inst.entity.activeInHierarchy) continue;
      this.keysOf(inst);
      // Timers
      for (const t of inst.timers) {
        if (t.done || this.elapsed < t.next) continue;
        this.start(t.handler.actions, this.ctx(inst.entity, null, t.label));
        if (t.handler.every) {
          const every = Math.max(0.05, Number(this.eval(t.handler.every, this.ctx(inst.entity, null, t.label))) || 1);
          t.next += every;
          if (t.next < this.elapsed) t.next = this.elapsed + every;
        } else t.done = true;
      }
      // Near
      for (const n of inst.near) {
        const ctx = this.ctx(inst.entity, null, n.label);
        const target = this.resolveTarget(n.handler.target, ctx);
        if (!target) continue;
        const d = this.worldPos(inst.entity).distanceTo(this.worldPos(target));
        const range = Number(this.eval(n.handler.distance, ctx)) || 3;
        if (!n.inside && d <= range) {
          n.inside = true;
          this.start(n.handler.actions, this.ctx(inst.entity, target, n.label));
        } else if (n.inside && d > range * 1.1) {
          n.inside = false;
          this.start(n.handler.leave, this.ctx(inst.entity, target, n.label));
        }
      }
      // Every frame
      for (const src of inst.sources) {
        const actions = src.script.handlers.update;
        if (actions?.length) this.start(actions, this.ctx(inst.entity, null, src.label));
      }
    }
  }

  /** While the game is paused (menus): nothing moves, but key presses still run (Esc to resume). */
  pausedUpdate(): void {
    if (!this.running || !this.ready || !this.world) return;
    for (const inst of [...this.instances.values()]) {
      if (this.world.getById(inst.entity.id) && inst.entity.activeInHierarchy) this.keysOf(inst);
    }
  }

  private keysOf(inst: Instance): void {
    const input = this.host.input;
    if (!input) return;
    for (const src of inst.sources) {
      for (const [name, actions] of Object.entries(src.script.keys)) {
        const binding = keyBinding(name);
        const pressed = binding ? input.wasPressed(binding) : INPUT_ACTIONS.includes(name) && input.actionPressed(name);
        if (pressed) this.start(actions, this.ctx(inst.entity, null, src.label));
      }
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  private stopAll(): void {
    this.ready = false;
    this.coroutines = [];
    this.instances.clear();
    this.vars.clear();
    this.pendingContacts.length = 0;
    this.warnedOnce.clear();
    this.carried.clear();
    this.lastPrompt = '';
    this.game = { ...this.gameDefaults };
    this.elapsed = 0;
    this.host.hud?.clear();
  }

  private async prepare(token: number): Promise<void> {
    const world = this.world;
    if (!world) return;
    this.startIds = new Set([...world.all()].map((e) => e.id));
    const entities = [...world.all()].filter((e) => e.has(Script) || e.has(Traits));
    // Compile every script asset first so all objects start together.
    await Promise.all(entities.map((e) => this.scriptFor(e).catch(() => undefined)));
    if (token !== this.token || !this.running) return;
    this.ready = true;
    for (const e of entities) await this.rebuild(e, true, token);
  }

  /** Load + compile the Script component's asset (cached). */
  private scriptFor(e: Entity): Promise<CompiledScript | undefined> {
    const id = e.get(Script)?.script;
    if (!id) return Promise.resolve(undefined);
    let p = this.compiled.get(id);
    if (!p) {
      const assets = this.host.assets;
      if (!assets) return Promise.resolve(undefined);
      p = assets.loadText(id).then(async (text) => {
        const name = (await assets.resolve(id)).name;
        const compiled = ScriptSystem.check(text, name);
        this.compiledNow.set(id, compiled);
        return compiled;
      });
      this.compiled.set(id, p);
      p.catch(() => this.compiled.get(id) === p && this.compiled.delete(id));
    }
    return p;
  }

  /** (Re)build an entity's running scripts. `fresh` = game just started (run start). */
  private async rebuild(e: Entity, fresh: boolean, token = this.token): Promise<void> {
    let user: CompiledScript | undefined;
    const scriptId = e.get(Script)?.script;
    // Already compiled: no waiting, so a spawned copy starts in the same frame.
    if (!scriptId) user = undefined;
    else if (this.compiledNow.has(scriptId)) user = this.compiledNow.get(scriptId);
    else {
      try {
        user = await this.scriptFor(e);
      } catch (err) {
        this.log('error', `${e.name}: couldn't load its script (${err instanceof Error ? err.message : err})`, e);
      }
    }
    if (token !== this.token || !this.running || !this.world?.getById(e.id)) return;
    if (user && !user.ok) {
      const d = user.diagnostics.find((x) => x.severity === 'error')!;
      this.log('error', `${user.name} line ${d.line}: ${d.message} (the script won't run until this is fixed)`, e);
      user = undefined;
    }

    const traitNames = new Set([...(e.get(Traits)?.traits ?? []), ...(user?.traits ?? [])]);
    const sources: Source[] = [];
    for (const name of traitNames) {
      const def = TRAIT_BY_NAME.get(name);
      if (!def) {
        this.warnOnce(`trait:${name}`, `${e.name}: unknown trait "${name}"`, e);
        continue;
      }
      if (def.comingIn) {
        this.warnOnce(`soon:${name}`, `The "${name}" trait arrives in ${def.comingIn} — it does nothing yet.`, e);
        continue;
      }
      if (fresh) def.setup?.(e, this.flat);
      const s = traitScript(name, this.flat);
      if (s) sources.push({ script: s, label: `${e.name} › ${name}` });
    }
    if (user) {
      for (const t of user.tags) e.tags.add(t);
      sources.push({ script: user, label: `${e.name} › ${user.name}` });
    }

    const existing = this.instances.get(e.id);
    const vars = this.varsOf(e);
    // Defaults from traits, then the script, then this object's own values — but keep
    // anything already set while playing (hot reload shouldn't reset health).
    const overrides = { ...((e.get(Traits) as { props?: Record<string, unknown> } | undefined)?.props ?? {}), ...(e.get(Script)?.props ?? {}) };
    for (const src of sources) for (const [k, v] of Object.entries(src.script.props)) if (!(k in vars)) vars[k] = structuredClone(v);
    for (const [k, v] of Object.entries(overrides)) if (fresh || !existing) vars[k] = structuredClone(v);
    if (fresh) vars.startPosition = [...(e.get(Transform)?.position ?? [0, 0, 0])];

    const inst: Instance = {
      entity: e,
      sources,
      functions: new Map(),
      timers: [],
      near: [],
    };
    for (const src of sources) {
      for (const [name, actions] of Object.entries(src.script.functions)) inst.functions.set(name, { actions, label: src.label });
      for (const t of src.script.timers) {
        const after = t.after ? Number(this.eval(t.after, this.ctx(e, null, src.label))) || 0 : undefined;
        const every = t.every ? Number(this.eval(t.every, this.ctx(e, null, src.label))) || 1 : 1;
        inst.timers.push({ handler: t, label: src.label, next: this.elapsed + (after ?? every), done: false });
      }
      for (const n of src.script.near) inst.near.push({ handler: n, label: src.label, inside: false });
    }
    if (!sources.length) {
      this.instances.delete(e.id);
      return;
    }
    this.instances.set(e.id, inst);
    if (fresh || !existing) this.fire(e, 'start', null);
  }

  private forget(entityId: string): void {
    this.carried.delete(entityId);
    for (const [obj, holder] of this.carried) if (holder === entityId) this.carried.delete(obj);
    this.instances.delete(entityId);
    this.vars.delete(entityId);
    this.coroutines = this.coroutines.filter((c) => c.entityId !== entityId);
  }

  private async hotReload(assetId: string): Promise<void> {
    if (!this.compiled.has(assetId)) return;
    this.compiled.delete(assetId);
    this.compiledNow.delete(assetId);
    if (!this.running || !this.ready || !this.world) return;
    const users = [...this.world.all()].filter((e) => e.get(Script)?.script === assetId);
    for (const e of users) await this.rebuild(e, false);
    if (users.length) {
      const s = await this.scriptFor(users[0]).catch(() => undefined);
      if (s?.ok) this.log('info', `Reloaded ${s.name} while playing`);
    }
  }

  // ── running actions ───────────────────────────────────────────────────────

  private ctx(self: Entity, other: Entity | null, label: string, args: Record<string, unknown> = {}): Ctx {
    return { self, other, args, index: 0, label, steps: { n: 0 } };
  }

  /** Run an event's handlers on an entity (each source separately, so guards don't clash). */
  /** Does this object have a script function with this name (e.g. "takeDamage")? */
  hasFunction(e: Entity, name: string): boolean {
    return !!this.instances.get(e.id)?.functions.get(name);
  }

  /**
   * Run one of an object's script functions from engine code (weapons hitting things).
   * `caller` becomes "other" inside it. Returns false if there's no such function.
   */
  invoke(e: Entity, name: string, args: Record<string, unknown> = {}, caller: Entity | null = null): boolean {
    const fn = this.instances.get(e.id)?.functions.get(name);
    if (!fn || !this.running) return false;
    this.start(fn.actions, { ...this.ctx(e, caller, fn.label), args });
    return true;
  }

  /** Fire an object's on.message handler (engine code telling a script something happened). */
  notify(e: Entity, message: string, other: Entity | null = null): void {
    const inst = this.instances.get(e.id);
    if (!inst || !e.activeInHierarchy) return;
    for (const src of inst.sources) {
      const actions = src.script.messages[message];
      if (actions?.length) this.start(actions, this.ctx(e, other, src.label));
    }
  }

  private fire(e: Entity, event: string, other: Entity | null): void {
    const inst = this.instances.get(e.id);
    if (!inst || !e.activeInHierarchy) return;
    for (const src of inst.sources) {
      const actions = src.script.handlers[event];
      if (actions?.length) this.start(actions, this.ctx(e, other, src.label));
    }
  }

  private start(actions: Action[], ctx: Ctx): void {
    const co: Coroutine = { gen: this.run(actions, ctx), wakeAt: 0, entityId: ctx.self.id, ctx };
    this.coroutines.push(co);
    this.step(co);
  }

  private step(co: Coroutine): void {
    co.ctx.steps.n = 0;
    try {
      const r = co.gen.next();
      if (r.done) this.coroutines = this.coroutines.filter((c) => c !== co);
      else co.wakeAt = this.elapsed + Math.max(0, r.value);
    } catch (err) {
      this.coroutines = this.coroutines.filter((c) => c !== co);
      this.log('error', `${co.ctx.label}: ${err instanceof Error ? err.message : String(err)}`, co.ctx.self);
    }
  }

  private *run(actions: Action[], ctx: Ctx): Generator<number, Flow, void> {
    for (const a of actions) {
      if (++ctx.steps.n > STEP_BUDGET) {
        throw new ScriptError(`line ${a.line}: this looks like an endless loop — add a { wait } inside it.`);
      }
      if (!this.world?.getById(ctx.self.id)) return 'stop'; // self was destroyed
      let flow: Flow;
      try {
        flow = yield* this.exec(a, ctx);
      } catch (err) {
        if (err instanceof ScriptError && /^line \d+/.test(err.message)) throw err;
        throw new ScriptError(`line ${a.line} (${a.key}): ${err instanceof Error ? err.message : String(err)}`);
      }
      if (flow === 'stop') return 'stop';
    }
    return 'done';
  }

  private *exec(a: Action, ctx: Ctx): Generator<number, Flow, void> {
    const p = a.params;
    const expr = (name: string): unknown => {
      const x = p[name];
      return x && (x.kind === 'expr' || x.kind === 'path') ? this.eval(x.expr, ctx) : undefined;
    };
    const has = (name: string) => p[name] !== undefined;
    const text = (name: string): string => {
      const x = p[name];
      return x?.kind === 'text' ? this.renderText(x.text, ctx) : '';
    };
    const actions = (name: string): Action[] => {
      const x = p[name];
      return x?.kind === 'actions' ? x.actions : [];
    };
    const target = (name: string, fallbackSelf = true): Entity | null => {
      const x = p[name];
      if (x?.kind === 'target') return this.resolveTarget(x.target, ctx);
      return fallbackSelf ? ctx.self : null;
    };
    const pathExpr = (): Expr => {
      const x = p[a.key];
      if (x?.kind !== 'path') throw new ScriptError('missing what to change');
      return x.expr;
    };

    switch (a.key) {
      case 'set':
        this.assign(pathExpr(), expr('to'), ctx);
        return 'done';
      case 'add':
      case 'subtract':
      case 'multiply': {
        const e = pathExpr();
        const cur = this.eval(e, ctx);
        const amount = a.key === 'multiply' ? (has('by') ? expr('by') : 2) : has('value') ? expr('value') : 1;
        this.assign(e, combine(a.key, cur, amount), ctx);
        return 'done';
      }
      case 'toggle': {
        const e = pathExpr();
        this.assign(e, !truthy(this.eval(e, ctx)), ctx);
        return 'done';
      }
      case 'if': {
        const ok = truthy(expr('if'));
        if (!has('then') && !has('else')) return ok ? 'done' : 'stop'; // guard
        return yield* this.run(ok ? actions('then') : actions('else'), ctx);
      }
      case 'repeat': {
        const raw = expr('repeat');
        const times = raw === FOREVER ? FOREVER : Math.max(0, Math.floor(Number(raw) || 0));
        for (let i = 0; i < times; i++) {
          const flow = yield* this.run(actions('do'), { ...ctx, index: i });
          if (flow === 'stop') return 'stop';
        }
        return 'done';
      }
      case 'wait': {
        const s = Number(expr('wait')) || 0;
        if (s > 0) yield s;
        return 'done';
      }
      case 'stop':
        return truthy(has('stop') ? expr('stop') : true) ? 'stop' : 'done';
      case 'call': {
        const name = p.call?.kind === 'name' ? p.call.name : '';
        const on = target('on');
        if (!on) return 'done';
        const fn = this.instances.get(on.id)?.functions.get(name);
        if (!fn) {
          this.warnOnce(`fn:${on.id}:${name}`, `${ctx.label}: ${on.name} has no function "${name}"`, ctx.self);
          return 'done';
        }
        const args: Record<string, unknown> = {};
        if (p.args?.kind === 'args') for (const [k, x] of Object.entries(p.args.args)) args[k] = this.eval(x, ctx);
        // "other" inside the function is whoever called it.
        yield* this.run(fn.actions, { self: on, other: ctx.self, args, index: 0, label: fn.label, steps: ctx.steps });
        return 'done';
      }
      case 'destroy': {
        const e = target('destroy');
        if (e && this.world?.getById(e.id)) this.world.destroyEntity(e);
        return e === ctx.self ? 'stop' : 'done';
      }
      case 'spawn': {
        const template = target('spawn', false);
        if (!template || !this.world) {
          this.warnOnce(`spawn:${a.path}`, `${ctx.label}: nothing called that to spawn`, ctx.self);
          return 'done';
        }
        const at = has('at') ? this.toPosition(expr('at')) : this.worldPos(ctx.self);
        const offset = has('offset') ? this.toPosition(expr('offset')) : new THREE.Vector3();
        const copy = instantiateEntity(this.world, serializeEntity(template), null, false);
        copy.enabled = true;
        const t = copy.get(Transform);
        if (t) copy.set(Transform, { position: vec(at.add(offset)) });
        // New objects with scripts start right away (rebuild runs start).
        if (copy.has(Script) || copy.has(Traits)) void this.rebuild(copy, true);
        return 'done';
      }
      case 'show':
      case 'hide': {
        const e = target(a.key);
        if (e) e.enabled = a.key === 'show';
        return 'done';
      }
      case 'move':
      case 'rotate': {
        const e = target('on');
        const delta = this.toPosition(expr(a.key));
        const time = Number(expr('time')) || 0;
        if (!e) return 'done';
        const field = a.key === 'move' ? 'position' : 'rotation';
        if (time <= 0) {
          this.nudge(e, field, delta, 1);
          return 'done';
        }
        let done = 0;
        let t = 0;
        while (done < 1) {
          yield 0;
          if (!this.world?.getById(e.id)) return 'stop';
          t += this.delta;
          const frac = Math.min(1, t / time);
          this.nudge(e, field, delta, frac - done);
          done = frac;
        }
        return 'done';
      }
      case 'moveTo': {
        const e = target('on');
        const dest = this.toPosition(expr('moveTo'));
        const time = Number(expr('time')) || 0;
        if (!e) return 'done';
        if (time <= 0) {
          this.setWorldPosition(e, dest);
          return 'done';
        }
        const from = this.worldPos(e);
        let t = 0;
        while (t < time) {
          yield 0;
          if (!this.world?.getById(e.id)) return 'stop';
          t += this.delta;
          this.setWorldPosition(e, from.clone().lerp(dest, Math.min(1, t / time)));
        }
        return 'done';
      }
      case 'playMusic': {
        const e = target('playMusic');
        if (!e?.has('Music')) {
          this.warnOnce(`music:${a.path}`, `${ctx.label}: that object has no Music`, ctx.self);
          return 'done';
        }
        void this.host.audio?.playMusic?.(e);
        return 'done';
      }
      case 'stopMusic':
        this.host.audio?.stopMusic?.(has('stopMusic') ? Number(expr('stopMusic')) || 1.5 : 1.5);
        return 'done';
      case 'fire':
      case 'reload': {
        const e = target(a.key);
        if (!e?.has('Weapon')) {
          this.warnOnce(`weapon:${a.path}`, `${ctx.label}: that object has no Weapon`, ctx.self);
          return 'done';
        }
        if (a.key === 'fire') this.host.weapons?.fire(e);
        else this.host.weapons?.reload(e);
        return 'done';
      }
      case 'useCamera': {
        const cam = target('useCamera', false);
        if (!cam?.has('Camera') || !this.world) {
          this.warnOnce(`cam:${a.path}`, `${ctx.label}: that object has no Camera`, ctx.self);
          return 'done';
        }
        for (const e of this.world.query('Camera')) {
          const primary = e === cam;
          if ((e.get('Camera') as { primary: boolean }).primary !== primary) e.set('Camera', { primary });
        }
        if (!cam.enabled) cam.enabled = true;
        return 'done';
      }
      case 'lookAt': {
        const e = target('on');
        if (!e) return 'done';
        const to = this.toPosition(expr('lookAt'));
        const d = to.sub(this.worldPos(e));
        // 2D: turning would show the picture edge-on, so it faces left or right instead.
        if (this.flat) {
          if (Math.abs(d.x) > 1e-3) this.host.sprites?.setFacing(e.id, d.x < 0);
          return 'done';
        }
        const yaw = Math.atan2(d.x, d.z);
        const pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
        this.setEntityProp(e, 'rotation', [round(THREE.MathUtils.radToDeg(pitch)), round(THREE.MathUtils.radToDeg(yaw)), 0]);
        return 'done';
      }
      case 'chase': {
        const who = ctx.self;
        const goal = target('chase', false);
        if (!goal || goal === who) return 'done';
        const from = this.worldPos(who);
        const to = this.worldPos(goal);
        // 2D seen from above chases along Y too (side-on, Y is up: gravity does that).
        const topDown = this.flat && !!who.get(CharacterController)?.topDown;
        const dir = new THREE.Vector3(to.x - from.x, topDown ? to.y - from.y : 0, to.z - from.z);
        const dist = dir.length();
        const stopAt = has('stopAt') ? Number(expr('stopAt')) || 0 : 1.2;
        if (dist <= stopAt || dist < 1e-4) return 'done';
        dir.divideScalar(dist);
        if (who.has(CharacterController) && this.host.physics) {
          this.host.physics.setMoveIntent(who, dir, truthy(expr('run')));
        } else {
          const speed = has('speed') ? Number(expr('speed')) || 0 : 3;
          const step = Math.min(dist - stopAt, speed * this.delta);
          this.setWorldPosition(who, from.addScaledVector(dir, step));
          if (this.flat) {
            if (Math.abs(dir.x) > 1e-3) this.host.sprites?.setFacing(who.id, dir.x < 0);
          } else this.setEntityProp(who, 'rotation', [0, round(THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z))), 0]);
        }
        return 'done';
      }
      case 'pickUp': {
        const obj = target('pickUp');
        const by = p.by?.kind === 'target' ? this.resolveTarget(p.by.target, ctx) : (this.player() ?? null);
        if (!obj || !by || obj === by) return 'done';
        this.carried.set(obj.id, by.id);
        this.host.physics?.setHeld(obj, true);
        this.updateCarried();
        return 'done';
      }
      case 'drop': {
        const obj = target('drop');
        if (obj && this.carried.delete(obj.id)) this.host.physics?.setHeld(obj, false);
        return 'done';
      }
      case 'push':
      case 'velocity': {
        const e = target('on');
        const v = this.toPosition(expr(a.key));
        if (!e || !this.host.physics) return 'done';
        if (a.key === 'push') this.host.physics.applyImpulse(e, v);
        else this.host.physics.setVelocity(e, v);
        return 'done';
      }
      case 'color': {
        const e = target('on');
        if (e?.has(MeshRenderer)) e.set(MeshRenderer, { color: String(expr('color')) });
        // Sprites: a picture is tinted, a shape is coloured.
        const sprite = e?.get(Sprite);
        if (e && sprite) e.set(Sprite, sprite.image ? { tint: String(expr('color')) } : { color: String(expr('color')) });
        return 'done';
      }
      case 'pause':
      case 'resume': {
        const v = expr(a.key);
        const on = a.key === 'pause' ? v !== false && v !== 0 : !(v !== false && v !== 0);
        if (this.host.game) this.host.game.pause(on);
        else this.warnOnce(`pause:${a.path}`, `${ctx.label}: pausing needs the game running`, ctx.self);
        return 'done';
      }
      case 'save':
      case 'load':
      case 'deleteSave': {
        const slot = String(expr(a.key) ?? 'game') || 'game';
        const store = this.host.saves;
        if (!store) {
          this.warnOnce(`save:${a.path}`, `${ctx.label}: saving needs the game running`, ctx.self);
          return 'done';
        }
        if (a.key === 'save') store.write(slot, JSON.stringify(this.captureSave(), saveReplacer));
        else if (a.key === 'deleteSave') store.remove(slot);
        else {
          const text = store.read(slot);
          if (!text) {
            this.log('warn', `${ctx.label}: there's no saved game called "${slot}"`, ctx.self);
            return 'done';
          }
          this.applySave(JSON.parse(text) as SaveData);
          // Loading moves things (maybe this object too): the rest of this list doesn't run.
          return 'stop';
        }
        return 'done';
      }
      case 'restart': {
        if (expr('restart') !== false) this.host.game?.restart();
        return 'done';
      }
      case 'keyframes': {
        const e = target('on');
        const command = String(expr('keyframes') ?? 'play');
        if (!e || !this.host.keyframes?.(e, command)) this.warnOnce(`keyframes:${a.path}`, `${ctx.label}: that object has no Keyframes`, ctx.self);
        return 'done';
      }
      case 'animate': {
        const e = target('on');
        const what = String(expr('animate') ?? '');
        // Animated characters play it once and go back to moving; other models switch clip.
        if (e && this.host.animate?.(e, what)) return 'done';
        if (e?.has(ModelRenderer)) e.set(ModelRenderer, { animation: what, playAnimation: true });
        return 'done';
      }
      case 'send': {
        const name = p.send?.kind === 'name' ? p.send.name : '';
        const to = p.to?.kind === 'target' ? p.to.target : { kind: 'expr' as const, expr: { t: 'id' as const, name: 'all' } };
        const receivers =
          to.kind === 'expr' && to.expr.t === 'id' && to.expr.name === 'all'
            ? [...this.instances.values()].map((i) => i.entity)
            : [this.resolveTarget(to, ctx)].filter((x): x is Entity => !!x);
        for (const r of receivers) {
          const inst = this.instances.get(r.id);
          if (!inst) continue;
          for (const src of inst.sources) {
            const list = src.script.messages[name];
            if (list?.length) this.start(list, this.ctx(r, ctx.self, src.label));
          }
        }
        return 'done';
      }
      case 'burst': {
        const e = target('burst');
        if (e) this.host.effects?.burst(e);
        return 'done';
      }
      case 'play':
      case 'stopSound': {
        const e = target(a.key);
        if (!e) return 'done';
        if (!e.has('AudioSource')) {
          this.warnOnce(`snd:${e.id}`, `${ctx.label}: ${e.name} has no Audio Source to play`, ctx.self);
          return 'done';
        }
        if (a.key === 'play') void this.host.audio?.play(e);
        else this.host.audio?.stop(e);
        return 'done';
      }
      case 'log':
        this.log('info', text('log'), ctx.self);
        return 'done';
      case 'say': {
        const msg = text('say');
        this.host.hud?.say(msg, Number(expr('time')) || 2);
        this.log('info', `Message: ${msg}`, ctx.self);
        return 'done';
      }
      case 'dialog': {
        const speaker = has('speaker') ? display(expr('speaker')) : ctx.self.name;
        const msg = text('dialog');
        this.host.hud?.dialog(speaker, msg, Number(expr('time')) || 4);
        this.log('info', `${speaker}: ${msg}`, ctx.self);
        return 'done';
      }
      case 'bar': {
        const slot = String(has('slot') ? expr('slot') : 'top-right') as HudSlot;
        const color = has('color') ? String(expr('color')) : undefined;
        this.host.hud?.setBar(HUD_SLOTS.includes(slot) ? slot : 'top-right', has('label') ? text('label') : '', Number(expr('bar')), color);
        return 'done';
      }
      case 'hud': {
        const slot = String(has('slot') ? expr('slot') : 'top-left') as HudSlot;
        this.host.hud?.setText(HUD_SLOTS.includes(slot) ? slot : 'top-left', text('hud'));
        return 'done';
      }
      default: {
        const spec = ACTION_BY_KEY.get(a.key);
        if (spec?.comingIn) this.warnOnce(`soon:${a.key}`, `"${a.key}" arrives in ${spec.comingIn}.`, ctx.self);
        return 'done';
      }
    }
  }

  // ── values ────────────────────────────────────────────────────────────────

  private varsOf(e: Entity): Record<string, unknown> {
    let v = this.vars.get(e.id);
    if (!v) this.vars.set(e.id, (v = Object.create(null) as Record<string, unknown>));
    return v;
  }

  private eval(e: Expr, ctx: Ctx): unknown {
    return evaluate(e, this.scope(ctx));
  }

  private renderText(parts: TextTemplate, ctx: Ctx): string {
    return parts.map((p) => (typeof p === 'string' ? p : display(this.eval(p, ctx)))).join('');
  }

  private player(): Entity | undefined {
    return this.world?.findByTag('player')[0];
  }

  private resolveTarget(t: Target, ctx: Ctx): Entity | null {
    if (t.kind === 'name') {
      const e = this.world?.findByName(t.name);
      if (!e) this.warnOnce(`name:${t.name}`, `${ctx.label}: there's no object called "${t.name}"`, ctx.self);
      return e ?? null;
    }
    const v = this.eval(t.expr, ctx);
    if (v instanceof EntityRef) return v.entity;
    if (typeof v === 'string') return this.world?.findByName(v) ?? null;
    return null;
  }

  private scope(ctx: Ctx): ExprScope {
    return {
      lookup: (name) => {
        switch (name) {
          case 'self':
            return new EntityRef(ctx.self);
          case 'other':
            return ctx.other ? new EntityRef(ctx.other) : null;
          case 'player': {
            const p = this.player();
            return p ? new EntityRef(p) : null;
          }
          case 'game':
            return this.gameRef;
          case 'time':
            return this.timeRef;
          case 'input':
            return this.inputRef;
          case 'camera':
            return this.cameraRef;
          case 'args':
            return ctx.args;
          case 'index':
            return ctx.index;
          case 'forever':
            return FOREVER;
        }
        if (name.startsWith('$')) return ctx.args[name.slice(1)];
        const own = this.vars.get(ctx.self.id);
        if (own && name in own) return own[name];
        const byName = this.world?.findByName(name);
        return byName ? new EntityRef(byName) : undefined;
      },
      member: (obj, prop) => this.member(obj, prop),
      method: (obj, name, args) => this.method(obj, name, args),
      call: (name, args) => this.callFunction(name, args),
    };
  }

  private member(obj: unknown, prop: string): unknown {
    if (obj instanceof EntityRef) {
      const e = obj.entity;
      const t = e.get(Transform);
      switch (prop) {
        case 'name':
          return e.name;
        case 'id':
          return e.id;
        case 'position':
          return t ? [...this.worldPosArr(e)] : [0, 0, 0];
        case 'rotation':
          return t ? [...t.rotation] : [0, 0, 0];
        case 'scale':
          return t ? [...t.scale] : [1, 1, 1];
        case 'x':
          return this.worldPosArr(e)[0];
        case 'y':
          return this.worldPosArr(e)[1];
        case 'z':
          return this.worldPosArr(e)[2];
        case 'visible':
        case 'enabled':
          return e.enabled;
        case 'tags':
          return [...e.tags];
        case 'grounded':
          return this.host.physics?.isGrounded(e) ?? false;
        case 'climbing':
          return this.host.physics?.isClimbing(e) ?? false;
        case 'swimming':
          return this.host.physics?.isSwimming(e) ?? false;
        case 'held':
          return this.carried.has(e.id);
        case 'solid': {
          const c = e.get(Collider);
          return !!c && !c.isTrigger;
        }
        case 'opacity':
          return e.get(MeshRenderer)?.opacity ?? e.get(Sprite)?.opacity ?? 1;
      }
      // A component by its code name (UIText, Light, MeshRenderer…): every field becomes editable.
      if (/^[A-Z]/.test(prop) && getComponentDef(prop)) return e.has(prop) ? new ComponentRef(e, prop) : null;
      const v = this.vars.get(e.id);
      return v && prop in v ? v[prop] : undefined;
    }
    if (obj instanceof ComponentRef) return this.componentField(obj, prop);
    if (obj instanceof GameRef) return prop === 'paused' && !(prop in this.game) ? (this.host.game?.paused() ?? false) : safeMember(this.game, prop);
    if (obj instanceof TimeRef) return prop === 'delta' ? this.delta : prop === 'elapsed' ? this.elapsed : undefined;
    if (obj instanceof CameraRef) {
      const c = this.camPose();
      if (!c) return undefined;
      const round = (v: THREE.Vector3) => vec(v);
      switch (prop) {
        case 'position':
          return round(c.position);
        case 'forward':
          return round(c.forward);
        case 'right':
          return round(new THREE.Vector3().crossVectors(c.forward, new THREE.Vector3(0, 1, 0)).normalize());
        case 'yaw':
          return Math.round(THREE.MathUtils.radToDeg(Math.atan2(c.forward.x, c.forward.z)) * 100) / 100;
        case 'pitch':
          return Math.round(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(c.forward.y, -1, 1))) * 100) / 100;
      }
      return undefined;
    }
    if (obj instanceof InputRef) {
      const input = this.host.input;
      if (!input) return prop.startsWith('move') || prop.startsWith('look') ? 0 : false;
      if (prop === 'moveX' || prop === 'moveY' || prop === 'lookX' || prop === 'lookY') return input.axis(prop);
      if (prop === 'mouseX') return input.pointer.x;
      if (prop === 'mouseY') return input.pointer.y;
      return input.action(prop);
    }
    return safeMember(obj, prop);
  }

  private method(obj: unknown, name: string, args: unknown[]): unknown {
    if (obj instanceof EntityRef) {
      const e = obj.entity;
      if (name === 'is') {
        const tag = String(args[0] ?? '');
        return e.tags.has(tag) || e.name === tag || (e.get(Traits)?.traits ?? []).includes(tag);
      }
      if (name === 'has') {
        const what = String(args[0] ?? '');
        const v = this.vars.get(e.id);
        return (!!v && what in v) || !!this.instances.get(e.id)?.functions.has(what) || e.has(what);
      }
      if (name === 'distanceTo') return this.worldPos(e).distanceTo(this.toPosition(args[0]));
    }
    if (obj === null || obj === undefined) throw new ScriptError(`can't use .${name}() on nothing (is "other" or the object missing?)`);
    throw new ScriptError(`.${name}() doesn't exist here`);
  }

  private callFunction(name: string, args: unknown[]): unknown {
    const n = (i: number, d = 0) => (args[i] === undefined ? d : Number(args[i]));
    switch (name) {
      case 'random':
        return args.length >= 2 ? n(0) + Math.random() * (n(1) - n(0)) : Math.random() * n(0, 1);
      case 'randomInt': {
        const lo = Math.ceil(n(0));
        const hi = Math.floor(n(1, lo));
        return lo + Math.floor(Math.random() * (hi - lo + 1));
      }
      case 'pick':
        return args[Math.floor(Math.random() * args.length)];
      case 'abs':
        return Math.abs(n(0));
      case 'min':
        return Math.min(...args.map(Number));
      case 'max':
        return Math.max(...args.map(Number));
      case 'clamp':
        return Math.min(n(2), Math.max(n(1), n(0)));
      case 'round':
        return Math.round(n(0));
      case 'floor':
        return Math.floor(n(0));
      case 'ceil':
        return Math.ceil(n(0));
      case 'sqrt':
        return Math.sqrt(n(0));
      case 'sin':
        return Math.sin(THREE.MathUtils.degToRad(n(0)));
      case 'cos':
        return Math.cos(THREE.MathUtils.degToRad(n(0)));
      case 'lerp':
        return n(0) + (n(1) - n(0)) * n(2);
      case 'atan2':
        return THREE.MathUtils.radToDeg(Math.atan2(n(0), n(1)));
      case 'wrapAngle':
        return ((((n(0) + 180) % 360) + 360) % 360) - 180;
      case 'angleTo': {
        // Heading from a to b in degrees, the same way camera.yaw is measured.
        const d = this.toPosition(args[1]).sub(this.toPosition(args[0]));
        return THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z));
      }
      case 'distance':
        return this.toPosition(args[0]).distanceTo(this.toPosition(args[1]));
      case 'vec3':
        return [n(0), n(1), n(2)];
      case 'vec2':
        return [n(0), n(1)];
      case 'find': {
        const e = this.world?.findByName(String(args[0]));
        return e ? new EntityRef(e) : null;
      }
      case 'closest': {
        const tag = String(args[0]);
        const from = this.toPosition(args[1] ?? new EntityRef(this.player() ?? ([...(this.world?.all() ?? [])][0] as Entity)));
        let best: Entity | null = null;
        let bestD = Infinity;
        for (const e of this.world?.findByTag(tag) ?? []) {
          const d = this.worldPos(e).distanceTo(from);
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
        return best ? new EntityRef(best) : null;
      }
      case 'count':
        return this.world?.findByTag(String(args[0])).length ?? 0;
      case 'hasSave':
        return !!this.host.saves?.read(String(args[0] ?? 'game') || 'game');
      case 'lookTarget': {
        // What's in the middle of the screen (the player themself doesn't count).
        const c = this.camPose();
        if (!c || !this.host.physics) return null;
        const hit = this.host.physics.raycast(c.position, c.forward, args.length ? n(0) : 100, this.player() ?? undefined);
        return hit?.entity ? new EntityRef(hit.entity) : null;
      }
      case 'lookPoint': {
        const c = this.camPose();
        if (!c) return [0, 0, 0];
        const max = args.length ? n(0) : 100;
        const hit = this.host.physics?.raycast(c.position, c.forward, max, this.player() ?? undefined);
        return vec(c.position.clone().addScaledVector(c.forward, hit ? hit.distance : max));
      }
      case 'raycast': {
        const from = this.toPosition(args[0]);
        const dir = this.toPosition(args[1]).normalize();
        const hit = this.host.physics?.raycast(from, dir, args.length > 2 ? n(2) : 100);
        return hit?.entity ? new EntityRef(hit.entity) : null;
      }
      case 'exists':
        return args[0] !== null && args[0] !== undefined;
      case 'text':
        return display(args[0]);
      case 'number':
        return Number(args[0]) || 0;
    }
    throw new ScriptError(`there's no function "${name}"`);
  }

  // ── changing things ───────────────────────────────────────────────────────

  private assign(e: Expr, value: unknown, ctx: Ctx): void {
    if (e.t === 'id') {
      if (['self', 'other', 'player', 'game', 'time', 'input', 'camera', 'index'].includes(e.name)) {
        throw new ScriptError(`"${e.name}" itself can't be changed — change one of its values, like ${e.name}.something`);
      }
      if (e.name.startsWith('$')) ctx.args[e.name.slice(1)] = value;
      else this.varsOf(ctx.self)[e.name] = value;
      return;
    }
    if (e.t === 'member' || e.t === 'index') {
      const obj = this.eval(e.obj, ctx);
      const key = e.t === 'member' ? e.prop : this.eval(e.index, ctx);
      if (typeof key === 'string' && ['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new ScriptError(`"${key}" can't be used as a name`);
      }
      if (obj instanceof EntityRef) return this.setEntityProp(obj.entity, String(key), value);
      if (obj instanceof ComponentRef) return this.setComponentField(obj, String(key), value);
      if (obj instanceof GameRef) {
        this.game[String(key)] = value;
        return;
      }
      if (Array.isArray(obj)) {
        const i = typeof key === 'number' ? key : ['x', 'y', 'z'].indexOf(String(key));
        if (i < 0) throw new ScriptError(`a list has no "${key}"`);
        const copy = [...obj];
        copy[i] = value;
        return this.assign(e.obj, copy, ctx);
      }
      if (obj && typeof obj === 'object') {
        (obj as Record<string, unknown>)[String(key)] = value;
        return;
      }
      throw new ScriptError(`can't change "${key}" of nothing`);
    }
    throw new ScriptError('that can\'t be changed');
  }

  private componentField(c: ComponentRef, field: string): unknown {
    const data = c.entity.get(c.type) as Record<string, unknown> | undefined;
    if (!data) return null;
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      const hint = didYouMean(field, Object.keys(data));
      throw new ScriptError(`${c.type} has no "${field}"${hint ? ` (did you mean "${hint}"?)` : ''}`);
    }
    const v = data[field];
    // Copies, so changing what you read never changes the object behind your back.
    return Array.isArray(v) ? [...v] : v && typeof v === 'object' ? structuredClone(v) : v;
  }

  private setComponentField(c: ComponentRef, field: string, value: unknown): void {
    const e = c.entity;
    const data = e.get(c.type) as Record<string, unknown> | undefined;
    if (!data) throw new ScriptError(`${e.name} has no ${c.type} any more`);
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      const hint = didYouMean(field, Object.keys(data));
      throw new ScriptError(`${c.type} has no "${field}"${hint ? ` (did you mean "${hint}"?)` : ''}`);
    }
    const spec = (getComponentDef(c.type)?.fields as Record<string, FieldSpec | undefined> | undefined)?.[field];
    const next = toFieldValue(spec, data[field], value, `${c.type}.${field}`);
    // Unchanged: skip, so a script can set a value every frame without rebuilding anything.
    if (JSON.stringify(next) === JSON.stringify(data[field])) return;
    e.set(c.type, { [field]: next });
  }

  private setEntityProp(e: Entity, prop: string, value: unknown): void {
    switch (prop) {
      case 'position':
        this.setWorldPosition(e, this.toPosition(value));
        return;
      case 'x':
      case 'y':
      case 'z': {
        const p = this.worldPos(e);
        p[prop] = Number(value) || 0;
        this.setWorldPosition(e, p);
        return;
      }
      case 'rotation':
      case 'scale': {
        const v = this.toPosition(value);
        if (e.has(Transform)) e.set(Transform, { [prop]: vec(v) });
        this.host.physics?.teleport(e);
        return;
      }
      case 'name':
        e.name = String(value);
        return;
      case 'visible':
      case 'enabled':
        e.enabled = truthy(value);
        return;
      case 'solid':
        // Unlike hide, the object keeps running its scripts.
        if (e.has(Collider)) e.set(Collider, { isTrigger: !truthy(value) });
        return;
      case 'opacity': {
        const opacity = Math.max(0, Math.min(1, Number(value) || 0));
        if (e.has(MeshRenderer)) e.set(MeshRenderer, { opacity });
        if (e.has(Sprite)) e.set(Sprite, { opacity });
        return;
      }
    }
    this.varsOf(e)[prop] = value;
  }

  private lastPrompt = '';

  /**
   * Only the nearest "interactable" object in range listens to E (so a door and a crate side by
   * side don't both react), and only its prompt is shown. Its id is game.interactTarget.
   */
  private updateInteraction(): void {
    const w = this.world;
    const player = this.player();
    let best: Entity | null = null;
    if (w && player) {
      const at = this.worldPos(player);
      let bestD = Infinity;
      for (const e of w.findByTag('interactable')) {
        if (!e.activeInHierarchy || e === player) continue;
        const range = Number(this.vars.get(e.id)?.interactRange ?? 2.5);
        const d = this.worldPos(e).distanceTo(at);
        if (d <= range && d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    this.game.interactTarget = best?.id ?? null;
    const template = best ? String(this.vars.get(best.id)?.prompt ?? '') : '';
    const prompt = template ? this.formatText(template, best!) : '';
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.host.hud?.setText('bottom', prompt || null);
    }
  }

  /** Keep carried objects floating in front of whoever carries them. */
  private updateCarried(): void {
    if (!this.world) return;
    for (const [objId, holderId] of this.carried) {
      const obj = this.world.getById(objId);
      const holder = this.world.getById(holderId);
      if (!obj || !holder) {
        this.carried.delete(objId);
        continue;
      }
      const m = worldMatrixOf(holder);
      const at = new THREE.Vector3().setFromMatrixPosition(m);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      // 2D: beside the carrier, on the side it faces (in front would be off the flat plane).
      const forward = this.flat
        ? new THREE.Vector3(this.host.sprites?.facingLeft(holder.id) ? -1 : 1, 0, 0)
        : new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
      const cc = holder.get(CharacterController);
      // Chest height, just in front of the carrier.
      const chest = cc ? cc.center[1] - cc.height / 2 + cc.height * 0.6 : 1;
      at.y += chest;
      at.addScaledVector(forward, (cc?.radius ?? 0.4) + 0.6);
      this.setWorldPosition(obj, at);
    }
  }

  /** Add a fraction of a vector to position/rotation (smooth moves call this each frame). */
  private nudge(e: Entity, field: 'position' | 'rotation', delta: THREE.Vector3, frac: number): void {
    const t = e.get(Transform);
    if (!t) return;
    const cur = t[field];
    // Fine rounding: smooth moves add many small steps, coarse rounding would drift.
    const fine = (v: number) => Math.round(v * 1e7) / 1e7;
    e.set(Transform, { [field]: [cur[0] + delta.x * frac, cur[1] + delta.y * frac, cur[2] + delta.z * frac].map(fine) });
    this.host.physics?.teleport(e);
  }

  /** Where the game camera is and which way it looks (null without a camera). */
  private camPose(): { position: THREE.Vector3; forward: THREE.Vector3 } | null {
    const cam = this.host.camera?.();
    if (!cam) return null;
    cam.updateWorldMatrix(true, false);
    return {
      position: new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld),
      forward: new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())).normalize(),
    };
  }

  private worldPos(e: Entity): THREE.Vector3 {
    return new THREE.Vector3().setFromMatrixPosition(worldMatrixOf(e));
  }

  private worldPosArr(e: Entity): Vec3 {
    return vec(this.worldPos(e));
  }

  private setWorldPosition(e: Entity, p: THREE.Vector3): void {
    if (!e.has(Transform)) return;
    const local = p.clone();
    if (e.parent) local.applyMatrix4(worldMatrixOf(e.parent).invert());
    e.set(Transform, { position: vec(local) });
    this.host.physics?.teleport(e);
  }

  /** Positions can be [x, y, z], an object (its position), or numbers. */
  private toPosition(v: unknown): THREE.Vector3 {
    if (v instanceof EntityRef) return this.worldPos(v.entity);
    if (Array.isArray(v)) return new THREE.Vector3(Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0);
    if (typeof v === 'number') return new THREE.Vector3(v, v, v);
    if (v === null || v === undefined) throw new ScriptError('expected a position like [x, y, z] or an object, got nothing');
    throw new ScriptError(`expected a position like [x, y, z], got ${display(v)}`);
  }

  private log(level: ScriptLog['level'], message: string, entity?: Entity): void {
    this.events.emit('log', { level, message, entityId: entity?.id });
  }

  private warnOnce(key: string, message: string, entity?: Entity): void {
    if (this.warnedOnce.has(key)) return;
    this.warnedOnce.add(key);
    this.log('warn', message, entity);
  }
}

function combine(op: string, cur: unknown, amount: unknown): unknown {
  const num = (v: unknown) => Number(v) || 0;
  if (Array.isArray(cur)) {
    const am = Array.isArray(amount) ? amount : [amount, amount, amount];
    return cur.map((c, i) => (op === 'add' ? num(c) + num(am[i]) : op === 'subtract' ? num(c) - num(am[i]) : num(c) * num(am[i])));
  }
  if (op === 'add' && typeof cur === 'string') return cur + display(amount);
  if (op === 'add') return num(cur) + num(amount);
  if (op === 'subtract') return num(cur) - num(amount);
  return num(cur) * num(amount);
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
const vec = (v: THREE.Vector3): Vec3 => [round(v.x), round(v.y), round(v.z)];

/** Turns a value from code into what a component field holds (numbers stay numbers, and so on). */
function toFieldValue(spec: FieldSpec | undefined, current: unknown, value: unknown, what: string): unknown {
  const kind = spec?.kind ?? (typeof current === 'number' ? 'number' : typeof current === 'boolean' ? 'boolean' : Array.isArray(current) ? 'list' : 'any');
  const num = (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ScriptError(`${what} needs a number, not ${display(v)}`);
    return n;
  };
  switch (kind) {
    case 'number':
      return num(value);
    case 'boolean':
      return truthy(value);
    case 'vec2':
    case 'vec3':
    case 'list': {
      const len = Array.isArray(current) ? current.length : kind === 'vec2' ? 2 : 3;
      if (!Array.isArray(value)) {
        // One number for all of them: scale = 2.
        if (typeof value === 'number' && len <= 3) return Array.from({ length: len }, () => value);
        throw new ScriptError(`${what} needs a list like (${Array.from({ length: len }, () => 0).join(', ')})`);
      }
      // vec3() into a 2-number field (UI offset) keeps the first two.
      const out = value.slice(0, len).map(num);
      while (out.length < len) out.push(0);
      return out;
    }
    case 'enum': {
      const options = (spec as { options: readonly string[] }).options;
      const v = String(value);
      if (!options.includes(v)) {
        const hint = didYouMean(v, options);
        throw new ScriptError(`${what} can be ${options.map((o) => `"${o}"`).join(', ')}${hint ? ` (did you mean "${hint}"?)` : ''}`);
      }
      return v;
    }
    case 'entity':
      return value instanceof EntityRef ? value.entity.name : value === null || value === undefined ? '' : String(value);
    case 'color':
    case 'string':
    case 'formula':
    case 'asset':
    case 'animation':
    case 'modelPart':
      return value === null || value === undefined ? '' : String(value);
    default:
      return value instanceof EntityRef ? value.entity.name : value;
  }
}
