import { Transform } from '../components/builtin';
import type { Entity } from '../core/Entity';
import type { World } from '../core/World';
import {
  SCENE_FORMAT_VERSION,
  defaultSceneSettings,
  type EntityData,
  type SceneData,
  type SceneSettings,
} from './SceneData';

export function serializeEntity(entity: Entity): EntityData {
  const components: Record<string, object> = {};
  for (const type of entity.componentTypes()) {
    components[type] = structuredClone(entity.get(type)!);
  }
  const data: EntityData = { id: entity.id, name: entity.name, components };
  if (!entity.enabled) data.enabled = false;
  if (entity.tags.size) data.tags = [...entity.tags];
  if (entity.children.length) data.children = entity.children.map(serializeEntity);
  return data;
}

export function serializeWorld(
  world: World,
  name: string,
  settings: SceneSettings = defaultSceneSettings(),
): SceneData {
  return {
    format: 'ege-scene',
    version: SCENE_FORMAT_VERSION,
    name,
    settings: structuredClone(settings),
    entities: world.roots.map(serializeEntity),
  };
}

export class SceneFormatError extends Error {}

/**
 * Creates entities from `data` under `parent`. With `keepIds` false (pasting/duplicating
 * or instantiating a prefab) every entity gets a fresh id.
 */
export function instantiateEntity(
  world: World,
  data: EntityData,
  parent: Entity | null = null,
  keepIds = true,
  /** Position among the parent's children (default: last). */
  index?: number,
): Entity {
  const entity = world.createEntity({
    id: keepIds ? data.id : undefined,
    name: data.name,
    parent,
    index,
  });
  if (data.enabled === false) entity.enabled = false;
  for (const t of data.tags ?? []) entity.tags.add(t);
  // Every entity has a Transform, even if the file forgot it.
  if (!data.components[Transform.type]) entity.add(Transform);
  for (const [type, value] of Object.entries(data.components)) entity.add(type, value);
  for (const child of data.children ?? []) instantiateEntity(world, child, entity, keepIds);
  return entity;
}

/** Validates the top-level shape of untrusted JSON and fills in missing settings. */
export function parseScene(json: unknown): SceneData {
  if (!json || typeof json !== 'object') throw new SceneFormatError('Scene file is not an object');
  const d = json as Partial<SceneData>;
  if (d.format !== 'ege-scene') throw new SceneFormatError('Not an Easy Game Engine scene file');
  if (typeof d.version !== 'number' || d.version > SCENE_FORMAT_VERSION) {
    throw new SceneFormatError(
      `Scene was saved by a newer engine (format v${d.version}); please update the editor`,
    );
  }
  if (!Array.isArray(d.entities)) throw new SceneFormatError('Scene has no entities list');
  const seen = new Set<string>();
  const defaults = defaultSceneSettings();
  const s = (d.settings ?? {}) as Partial<SceneSettings>;
  return {
    format: 'ege-scene',
    version: d.version,
    name: typeof d.name === 'string' ? d.name : 'Untitled',
    settings: {
      ...defaults,
      ...s,
      fog: { ...defaults.fog, ...(s.fog ?? {}) },
      environment: { ...defaults.environment, ...(s.environment ?? {}) },
    },
    entities: d.entities.map((e, i) => validateEntity(e, `entities[${i}]`, seen)),
  };
}

function validateEntity(e: unknown, path: string, seen: Set<string>): EntityData {
  if (!e || typeof e !== 'object') throw new SceneFormatError(`${path} is not an object`);
  const d = e as Partial<EntityData>;
  if (typeof d.id !== 'string' || !d.id) throw new SceneFormatError(`${path} is missing an id`);
  if (seen.has(d.id)) throw new SceneFormatError(`${path} reuses id "${d.id}"`);
  seen.add(d.id);
  if (d.components !== undefined && (typeof d.components !== 'object' || Array.isArray(d.components))) {
    throw new SceneFormatError(`${path}.components must be an object`);
  }
  return {
    id: d.id,
    name: typeof d.name === 'string' ? d.name : 'Entity',
    enabled: d.enabled,
    tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : undefined,
    components: d.components ?? {},
    children: Array.isArray(d.children)
      ? d.children.map((c, i) => validateEntity(c, `${path}.children[${i}]`, seen))
      : undefined,
  };
}

/** Replaces everything in `world` with the scene's entities. Returns the scene settings. */
export function loadSceneInto(world: World, data: SceneData): SceneSettings {
  world.clear();
  for (const e of data.entities) instantiateEntity(world, e, null, true);
  return data.settings;
}
