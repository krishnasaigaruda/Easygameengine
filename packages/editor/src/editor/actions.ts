import {
  getComponentDef,
  newId,
  serializeEntity,
  THREE,
  Transform,
  type Engine,
  type Entity,
  type EntityData,
  type Vec3,
  type World,
} from '@ege/runtime';
import { selectedEntities, useEditor } from '../state/editorStore';
import type { Command } from '../commands/History';
import {
  AddComponentCommand,
  BatchCommand,
  CreateEntityCommand,
  DeleteEntityCommand,
  RemoveComponentCommand,
  RenameCommand,
  ReparentCommand,
  SetComponentCommand,
  SetEnabledCommand,
  SetTagsCommand,
} from '../commands/commands';

// ── plumbing ────────────────────────────────────────────────────────────────

const state = () => useEditor.getState();

/** Runs a command through undo history (or directly while playing). */
export function runCommand(cmd: Command): boolean {
  return run(cmd);
}

function run(cmd: Command): boolean {
  const { history, log, playing, engine } = state();
  if (!history || !engine) return false;
  try {
    // While playing, edits apply immediately but aren't undoable — Stop restores the scene.
    if (playing) cmd.do(engine.world);
    else history.execute(cmd);
    return true;
  } catch (err) {
    log('error', `${cmd.label} failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function selected(): Entity | undefined {
  const { engine, selection } = state();
  return selection ? engine?.world.getById(selection) : undefined;
}

/**
 * The selection without objects whose parent is also selected (deleting or copying a parent
 * already includes its children), in Hierarchy order.
 */
export function topSelected(): Entity[] {
  const { engine } = state();
  if (!engine) return [];
  const chosen = new Set(selectedEntities());
  const out: Entity[] = [];
  const walk = (list: readonly Entity[]) => {
    for (const e of list) {
      if (chosen.has(e)) out.push(e);
      else walk(e.children);
    }
  };
  walk(engine.world.roots);
  return out;
}

const names = (list: Entity[]) => (list.length === 1 ? list[0].name : `${list.length} objects`);

let spawnPointProvider: () => Vec3 = () => [0, 0, 0];
/** The viewport registers where new objects should appear (in front of the camera). */
export function setSpawnPointProvider(fn: () => Vec3): void {
  spawnPointProvider = fn;
}

/** "Cube" → "Cube (1)" if a sibling already uses the name. */
export function uniqueName(base: string, siblings: readonly Entity[]): string {
  const taken = new Set(siblings.map((s) => s.name));
  if (!taken.has(base)) return base;
  const stem = base.replace(/ \(\d+\)$/, '');
  for (let i = 1; ; i++) {
    const name = `${stem} (${i})`;
    if (!taken.has(name)) return name;
  }
}

/** Deep copy with brand-new ids (for duplicate/paste). */
export function withFreshIds(data: EntityData): EntityData {
  return {
    ...structuredClone(data),
    id: newId(),
    children: data.children?.map(withFreshIds),
  };
}

// ── creating objects ────────────────────────────────────────────────────────

export const CREATE_PRESETS = {
  empty: { label: 'Empty', icon: 'square-dashed', components: {} },
  cube: { label: 'Cube', icon: 'box', components: { MeshRenderer: { shape: 'box' } } },
  sphere: { label: 'Sphere', icon: 'circle', components: { MeshRenderer: { shape: 'sphere' } } },
  plane: {
    label: 'Plane',
    icon: 'square',
    components: { MeshRenderer: { shape: 'plane' } },
    scale: [10, 1, 10] as Vec3,
    lift: 0,
  },
  cylinder: {
    label: 'Cylinder',
    icon: 'cylinder',
    components: { MeshRenderer: { shape: 'cylinder' } },
  },
  capsule: {
    label: 'Capsule',
    icon: 'pill',
    components: { MeshRenderer: { shape: 'capsule' } },
    lift: 1,
  },
  cone: { label: 'Cone', icon: 'cone', components: { MeshRenderer: { shape: 'cone' } } },
  torus: { label: 'Torus', icon: 'torus', components: { MeshRenderer: { shape: 'torus' } } },
  sun: {
    label: 'Sun Light',
    icon: 'sun',
    components: { Light: { kind: 'directional', intensity: 2.5, castShadow: true } },
    rotation: [-50, 30, 0] as Vec3,
    lift: 10,
  },
  pointLight: {
    label: 'Point Light',
    icon: 'lightbulb',
    components: { Light: { kind: 'point', intensity: 20, range: 15 } },
    lift: 2,
  },
  spotLight: {
    label: 'Spot Light',
    icon: 'flashlight',
    components: { Light: { kind: 'spot', intensity: 40, range: 25, castShadow: true } },
    rotation: [-60, 0, 0] as Vec3,
    lift: 4,
  },
  camera: { label: 'Camera', icon: 'video', components: { Camera: { primary: false } }, lift: 1.6 },
  terrain: { label: 'Terrain', icon: 'mountain', lift: 0, components: { Terrain: {} } },
  scatter: { label: 'Scatter (trees, rocks)', icon: 'trees', lift: 0, components: { Scatter: {} } },
  sky: { label: 'Sky', icon: 'sun', components: { Sky: {} } },
  fog: { label: 'Fog', icon: 'cloud-fog', components: { Fog: {} } },
  dayNight: { label: 'Day/Night Cycle', icon: 'sunrise', components: { DayNightCycle: {} } },
  postProcessing: { label: 'Post Processing', icon: 'wand', components: { PostProcessing: {} } },
  uiText: { label: 'Text', icon: 'file', components: { UIText: {} } },
  uiRing: {
    label: 'Ring Meter',
    icon: 'circle',
    components: {
      UIProgressBar: {
        anchor: 'bottom-left',
        offset: [40, -40],
        size: [86, 86],
        shape: 'ring',
        label: '{round(player.health or 0)}',
      },
    },
  },
  sprite: { label: 'Sprite', icon: 'image', lift: 0, components: { Sprite: { color: '#5b8def' } } },
  tilemap: { label: 'Tilemap', icon: 'grid', lift: 0, components: { Tilemap: {} } },
  light2d: { label: 'Light', icon: 'lightbulb', lift: 1, components: { Light2D: {} } },
  background2d: { label: 'Background', icon: 'image', lift: 0, components: { Sprite: { size: [48, 18], color: '#bcd9f0', layer: -5, parallax: 0.7 } } },
  circle2d: { label: 'Circle', icon: 'circle', lift: 0, components: { Sprite: { shape: 'circle', color: '#f2b84b' } } },
  platform2d: {
    label: 'Platform',
    icon: 'square',
    lift: 0,
    components: { Sprite: { size: [6, 1], color: '#6b8f4e' }, RigidBody: { type: 'static' }, Collider: {} },
  },
  player2d: {
    label: '2D Player',
    icon: 'person',
    lift: 1,
    components: {
      Sprite: { size: [0.8, 1.2], color: '#e0683a', layer: 2 },
      CharacterController: { height: 1.2, radius: 0.35, center: [0, 0, 0], speed: 5, runSpeed: 8, jumpHeight: 2.2 },
      Traits: { traits: ['player'] },
    },
  },
  playerTopDown: {
    label: 'Top-down Player',
    icon: 'person',
    lift: 0,
    components: {
      Sprite: { size: [0.9, 0.9], color: '#e0683a', layer: 2 },
      CharacterController: { height: 0.9, radius: 0.4, center: [0, 0, 0], speed: 5, runSpeed: 8, jumpHeight: 0, topDown: true },
      Traits: { traits: ['player'] },
    },
  },
  uiButton: { label: 'Button', icon: 'mouse', components: { UIButton: {} } },
  uiPanel: { label: 'Panel', icon: 'square', components: { UIPanel: {} } },
  uiImage: { label: 'Image', icon: 'image', components: { UIImage: {} } },
  uiBar: { label: 'Progress Bar', icon: 'gauge', components: { UIProgressBar: {} } },
} satisfies Record<
  string,
  {
    label: string;
    icon: string;
    components: Record<string, object>;
    scale?: Vec3;
    rotation?: Vec3;
    lift?: number;
  }
>;

export type CreatePreset = keyof typeof CREATE_PRESETS;

export function createObject(preset: CreatePreset, parentId: string | null = null): string | null {
  const { engine, select, log } = state();
  if (!engine) return null;
  const p: (typeof CREATE_PRESETS)[CreatePreset] = CREATE_PRESETS[preset];
  const parent = parentId ? (engine.world.getById(parentId) ?? null) : null;
  const spawn = parent ? ([0, 0, 0] as Vec3) : spawnPointProvider();
  const lift = 'lift' in p && p.lift !== undefined ? p.lift : 0.5;
  const data: EntityData = {
    id: newId(),
    name: uniqueName(p.label, parent ? parent.children : engine.world.roots),
    components: {
      Transform: {
        position: [spawn[0], spawn[1] + (parent ? 0 : lift), spawn[2]],
        rotation: 'rotation' in p ? p.rotation : [0, 0, 0],
        scale: 'scale' in p ? p.scale : [1, 1, 1],
      },
      ...structuredClone(p.components),
    },
  };
  // A new terrain starts flat, at ground level.
  if (data.components.Terrain) (data.components.Transform as { position: Vec3 }).position[1] = 0;
  if (!run(new CreateEntityCommand(data, parent?.id ?? null))) return null;
  select(data.id);
  log('info', `Created ${data.name}`, data.id);
  return data.id;
}

/** A new object with these components, in front of the camera (store effects, music…). */
export function createObjectWith(
  name: string,
  _icon: string,
  components: Record<string, object>,
): string | null {
  const { engine, select, log } = state();
  if (!engine) return null;
  const spawn = spawnPointProvider();
  const data: EntityData = {
    id: newId(),
    name: uniqueName(name, engine.world.roots),
    components: {
      Transform: {
        position: [spawn[0], spawn[1] + 1, spawn[2]],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      ...structuredClone(components),
    },
  };
  if (!run(new CreateEntityCommand(data, null))) return null;
  select(data.id);
  log('info', `Created ${data.name}`, data.id);
  return data.id;
}

// ── editing the selection ───────────────────────────────────────────────────

export function deleteEntity(id: string): void {
  const e = state().engine?.world.getById(id);
  if (e && run(new DeleteEntityCommand(e))) state().log('info', `Deleted ${e.name}`);
}

export function deleteSelected(): void {
  const list = topSelected();
  if (list.length <= 1) {
    if (list[0]) deleteEntity(list[0].id);
    return;
  }
  if (
    run(
      new BatchCommand(
        `Delete ${names(list)}`,
        list.map((e) => new DeleteEntityCommand(e)),
      ),
    )
  ) {
    state().log('info', `Deleted ${names(list)}`);
  }
}

export function duplicate(id: string): string | null {
  const { engine, select } = state();
  const e = engine?.world.getById(id);
  if (!engine || !e) return null;
  const siblings = e.parent ? e.parent.children : engine.world.roots;
  const copy = withFreshIds(serializeEntity(e));
  copy.name = uniqueName(e.name, siblings);
  if (
    !run(
      new CreateEntityCommand(
        copy,
        e.parent?.id ?? null,
        siblings.indexOf(e) + 1,
        `Duplicate ${e.name}`,
      ),
    )
  ) {
    return null;
  }
  select(copy.id);
  return copy.id;
}

export function duplicateSelected(): void {
  const list = topSelected();
  if (list.length <= 1) {
    if (list[0]) duplicate(list[0].id);
    return;
  }
  const { engine, selectMany } = state();
  if (!engine) return;
  const commands: Command[] = [];
  const copies: string[] = [];
  // Later siblings first, so earlier insert positions stay valid.
  for (const e of [...list].reverse()) {
    const siblings = e.parent ? e.parent.children : engine.world.roots;
    const copy = withFreshIds(serializeEntity(e));
    copy.name = uniqueName(e.name, siblings);
    commands.push(new CreateEntityCommand(copy, e.parent?.id ?? null, siblings.indexOf(e) + 1));
    copies.unshift(copy.id);
  }
  if (run(new BatchCommand(`Duplicate ${names(list)}`, commands))) selectMany(copies);
}

let clipboard: EntityData[] = [];

export function copySelected(): void {
  const list = topSelected();
  if (!list.length) return;
  clipboard = list.map((e) => serializeEntity(e));
  state().log('info', `Copied ${names(list)}`);
}

export function cutSelected(): void {
  copySelected();
  deleteSelected();
}

/** Pastes next to the selection (same parent), or at the top level. */
export function paste(): void {
  const { engine, selectMany } = state();
  if (!engine || !clipboard.length) return;
  const target = selected();
  const parent = target?.parent ?? null;
  const siblings = parent ? parent.children : engine.world.roots;
  const start = target ? siblings.indexOf(target) + 1 : undefined;
  const taken = [...siblings];
  const commands: Command[] = [];
  const ids: string[] = [];
  clipboard.forEach((data, i) => {
    const copy = withFreshIds(data);
    copy.name = uniqueName(copy.name, taken);
    taken.push({ name: copy.name } as Entity);
    commands.push(
      new CreateEntityCommand(
        copy,
        parent?.id ?? null,
        start === undefined ? undefined : start + i,
      ),
    );
    ids.push(copy.id);
  });
  const label = `Paste ${ids.length === 1 ? clipboard[0].name : `${ids.length} objects`}`;
  if (run(commands.length === 1 ? commands[0] : new BatchCommand(label, commands))) selectMany(ids);
}

export function hasClipboard(): boolean {
  return clipboard.length > 0;
}

/**
 * Put the selected objects under a new empty "Group" at their centre (one undo step).
 * Everything stays exactly where it is in the world.
 */
export function groupSelected(): void {
  const { engine, select } = state();
  const list = topSelected();
  if (!engine || !list.length) return;
  const centre = new THREE.Vector3();
  const worlds = list.map((e) => {
    const node = engine.render.nodeOf(e);
    node?.updateWorldMatrix(true, false);
    const m = node?.matrixWorld.clone() ?? new THREE.Matrix4();
    centre.add(new THREE.Vector3().setFromMatrixPosition(m));
    return m;
  });
  centre.divideScalar(list.length);
  const r = (v: number, p = 1000) => Math.round(v * p) / p;
  const group: EntityData = {
    id: newId(),
    name: uniqueName('Group', engine.world.roots),
    components: {
      Transform: {
        position: centre.toArray().map((v) => r(v)) as Vec3,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
  };
  let top = list[0];
  while (top.parent) top = top.parent;
  const index = engine.world.roots.indexOf(top);
  const commands: Command[] = [new CreateEntityCommand(group, null, index < 0 ? undefined : index)];
  const toGroup = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
  list.forEach((e, i) => {
    const local = toGroup.clone().multiply(worlds[i]);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    local.decompose(pos, quat, scl);
    const eul = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    const before = e.get(Transform);
    commands.push(new LateReparentCommand(e.id, group.id, i));
    if (before) {
      commands.push(
        new SetComponentCommand(e, Transform.type, before, {
          position: pos.toArray().map((v) => r(v)) as Vec3,
          rotation: [eul.x, eul.y, eul.z].map((v) => r(THREE.MathUtils.radToDeg(v), 100)) as Vec3,
          scale: scl.toArray().map((v) => r(v)) as Vec3,
        }),
      );
    }
  });
  if (run(new BatchCommand(`Group ${names(list)}`, commands))) select(group.id);
}

/** Re-parent by id at do-time (the new parent is created earlier in the same batch). */
class LateReparentCommand implements Command {
  readonly label = 'Move';
  private prev: { parent: string | null; index: number } | null = null;
  constructor(
    private readonly id: string,
    private readonly parentId: string,
    private readonly index: number,
  ) {}
  do(world: World): void {
    const e = world.getById(this.id)!;
    const list = e.parent ? e.parent.children : world.roots;
    this.prev = { parent: e.parent?.id ?? null, index: list.indexOf(e) };
    world.setParent(e, world.getById(this.parentId)!, this.index);
  }
  undo(world: World): void {
    const e = world.getById(this.id)!;
    world.setParent(
      e,
      this.prev?.parent ? world.getById(this.prev.parent)! : null,
      this.prev?.index,
    );
  }
}

/** Select every object in the scene (Ctrl/Cmd+A). */
export function selectAll(): void {
  const { engine, selectMany, selection } = state();
  if (!engine) return;
  selectMany(
    [...engine.world.all()].map((e) => e.id),
    selection,
  );
}

export function rename(id: string, name: string): void {
  const e = state().engine?.world.getById(id);
  const trimmed = name.trim();
  if (e && trimmed && trimmed !== e.name) run(new RenameCommand(e, trimmed));
}

/** Tags are lowercase words; scripts find objects by them. */
export function setTags(id: string, tags: string[]): void {
  const e = state().engine?.world.getById(id);
  if (!e) return;
  const clean = [
    ...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean)),
  ];
  if (clean.join(',') !== [...e.tags].join(',')) run(new SetTagsCommand(e, clean));
}

export function setEnabled(id: string, enabled: boolean): void {
  const e = state().engine?.world.getById(id);
  if (e && e.enabled !== enabled) run(new SetEnabledCommand(e, enabled));
}

/**
 * Local Transform that keeps `entity` at the same place in the world once it's under
 * `newParent` (what Unity does when you re-parent in the Hierarchy).
 */
function transformKeepingWorldPose(engine: Engine, entity: Entity, newParent: Entity | null) {
  const node = engine.render.nodeOf(entity);
  const parentNode = newParent ? engine.render.nodeOf(newParent) : engine.render.root;
  if (!node || !parentNode) return null;
  node.updateWorldMatrix(true, false);
  parentNode.updateWorldMatrix(true, false);
  const local = parentNode.matrixWorld.clone().invert().multiply(node.matrixWorld);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  local.decompose(pos, quat, scale);
  const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  const r = (v: number, p = 1000) => Math.round(v * p) / p;
  return {
    position: pos.toArray().map((v) => r(v)) as Vec3,
    rotation: [euler.x, euler.y, euler.z].map((v) => r(THREE.MathUtils.radToDeg(v), 100)) as Vec3,
    scale: scale.toArray().map((v) => r(v)) as Vec3,
  };
}

/**
 * Moves `id` under `parentId` (null = top level) at `index`, keeping its world position.
 * Returns false if not allowed (e.g. into its own child).
 */
export function reparent(id: string, parentId: string | null, index?: number): boolean {
  const engine = state().engine;
  const world = engine?.world;
  const e = world?.getById(id);
  if (!engine || !world || !e) return false;
  const parent = parentId ? (world.getById(parentId) ?? null) : null;
  if (parent === e || parent?.isDescendantOf(e)) return false;
  // Moving down within the same list: account for the slot the entity frees up.
  let i = index;
  const list = parent ? parent.children : world.roots;
  if (i !== undefined && e.parent === parent && list.indexOf(e) < i) i--;

  const commands: Command[] = [new ReparentCommand(e, parent, i)];
  const before = e.get(Transform);
  const after = parent !== e.parent ? transformKeepingWorldPose(engine, e, parent) : null;
  if (before && after) commands.push(new SetComponentCommand(e, Transform.type, before, after));
  return run(commands.length === 1 ? commands[0] : new BatchCommand(`Move ${e.name}`, commands));
}

/**
 * Applies a partial edit to a component through the history. Rapid edits to the same
 * component merge into one undo step (dragging a number, typing in a field).
 */
export function editComponent(entity: Entity, type: string, patch: object, label?: string): void {
  const before = entity.get(type);
  if (!before) return;
  const def = getComponentDef(type);
  const text = label ?? `Edit ${def?.label ?? type}`;
  // Editing the active object of a multi-selection changes that field on all of them.
  const { selection } = state();
  const others =
    entity.id === selection ? selectedEntities().filter((e) => e !== entity && e.has(type)) : [];
  const cmd = (e: Entity) => {
    const b = e.get(type)!;
    return new SetComponentCommand(
      e,
      type,
      b,
      { ...structuredClone(b), ...structuredClone(patch) },
      text,
    );
  };
  if (!others.length) run(cmd(entity));
  else
    run(new BatchCommand(`${text} (${others.length + 1} objects)`, [...others, entity].map(cmd)));
}

/**
 * Records an edit that was already applied live (e.g. gizmo drag): `before` is the data
 * from when the drag started.
 */
export function commitLiveEdit(entity: Entity, type: string, before: object): void {
  const { history } = state();
  const after = entity.get(type);
  if (!history || !after || JSON.stringify(before) === JSON.stringify(after)) return;
  history.push(new SetComponentCommand(entity, type, before, after, `Move ${entity.name}`));
  history.seal();
}

/** Several live edits (multi-object gizmo drag) as one undo step. */
export function commitLiveEdits(edits: { entity: Entity; before: object }[], type: string): void {
  const { history } = state();
  if (!history) return;
  const changed = edits.filter(({ entity, before }) => {
    const after = entity.get(type);
    return after && JSON.stringify(before) !== JSON.stringify(after);
  });
  if (!changed.length) return;
  const cmds = changed.map(
    ({ entity, before }) =>
      new SetComponentCommand(entity, type, before, entity.get(type)!, `Move ${entity.name}`),
  );
  history.push(
    cmds.length === 1 ? cmds[0] : new BatchCommand(`Move ${changed.length} objects`, cmds),
  );
  history.seal();
}

export function addComponent(entity: Entity, type: string): void {
  if (!entity.has(type)) run(new AddComponentCommand(entity, type));
}

export function removeComponent(entity: Entity, type: string): void {
  if (entity.has(type) && !getComponentDef(type)?.required)
    run(new RemoveComponentCommand(entity, type));
}

export function undo(): void {
  const { history, log, playing } = state();
  if (playing) {
    log(
      'info',
      'Undo is unavailable while playing. Press Stop to return to the editor (the scene resets).',
    );
    return;
  }
  try {
    history?.undo();
  } catch (err) {
    log('error', `Undo failed: ${String(err)}`);
  }
}

export function redo(): void {
  const { history, log, playing } = state();
  if (playing) return;
  try {
    history?.redo();
  } catch (err) {
    log('error', `Redo failed: ${String(err)}`);
  }
}
