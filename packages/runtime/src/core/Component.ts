/**
 * Components are plain JSON-friendly data. A ComponentDef describes one component type:
 * its default values plus field metadata the editor's Inspector uses to build forms.
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type FieldSpec =
  | { kind: 'number'; label?: string; min?: number; max?: number; step?: number }
  | { kind: 'vec3'; label?: string; step?: number }
  | { kind: 'vec2'; label?: string; step?: number; axes?: [string, string] }
  | { kind: 'color'; label?: string }
  | { kind: 'boolean'; label?: string }
  | { kind: 'string'; label?: string }
  /**
   * A live value: "expression" fields hold a formula (player.health / player.maxHealth);
   * "text" fields hold text with {formulas} inside. The Inspector offers a list to pick from.
   */
  /** The name of another object in the scene (picked from a list). */
  | { kind: 'entity'; label?: string }
  | { kind: 'formula'; label?: string; insert: 'expression' | 'text'; presets?: readonly { label: string; value: string }[] }
  | { kind: 'enum'; label?: string; options: readonly string[] }
  | { kind: 'asset'; label?: string; assetType: 'model' | 'texture' | 'hdri' | 'audio' | 'material' | 'script' }
  /** Dropdown of the animation clips inside the model referenced by `modelField`. */
  | { kind: 'animation'; label?: string; modelField: string }
  /** Dropdown of the separate models inside the model file in `modelField` (asset packs). */
  | { kind: 'modelPart'; label?: string; modelField: string }
  /** Checkbox list of traits. */
  | { kind: 'traits'; label?: string }
  /** Editable values for the props declared by the script in `scriptField`. */
  | { kind: 'scriptProps'; label?: string; scriptField: string };

/** Groups in the Add Component menu (like Unity's). */
export const COMPONENT_CATEGORIES = ['Rendering', 'Environment', 'Camera', 'Physics', 'Gameplay', 'UI', 'Audio', 'Effects'] as const;
export type ComponentCategory = (typeof COMPONENT_CATEGORIES)[number];

export interface ComponentDef<T extends object = object> {
  /** Stable id used in scene files, e.g. "Transform". */
  readonly type: string;
  /** Human-friendly name shown in the Inspector. */
  readonly label: string;
  /** Short emoji/icon for the Inspector and Hierarchy. */
  readonly icon?: string;
  /** One-line, beginner-friendly description. */
  readonly description?: string;
  /** Add Component menu group. Components without one (Transform) aren't offered there. */
  readonly category?: ComponentCategory;
  /** Only one of these per entity (all built-ins are). */
  readonly unique: boolean;
  /** Can't be removed from an entity (Transform). */
  readonly required?: boolean;
  /** Fresh default data. Must return a new object each call. */
  defaults(): T;
  readonly fields: { readonly [K in keyof T]?: FieldSpec };
}

const registry = new Map<string, ComponentDef>();

export function defineComponent<T extends object>(
  def: Omit<ComponentDef<T>, 'unique'> & { unique?: boolean },
): ComponentDef<T> {
  if (registry.has(def.type)) throw new Error(`Component "${def.type}" is already defined`);
  const full: ComponentDef<T> = { unique: true, ...def };
  registry.set(full.type, full as unknown as ComponentDef);
  return full;
}

export function getComponentDef(type: string): ComponentDef | undefined {
  return registry.get(type);
}

export function allComponentDefs(): ComponentDef[] {
  return [...registry.values()];
}

/**
 * Builds component data from defaults overlaid with (possibly partial / older) saved data.
 * Unknown keys are kept so newer files survive a round trip through an older engine.
 */
export function createComponentData<T extends object>(def: ComponentDef<T>, data?: Partial<T>): T {
  const base = def.defaults();
  if (!data) return base;
  return { ...base, ...structuredClone(data) };
}
