import { defineComponent } from '../core/Component';

export interface ScriptData {
  /** Script asset id (.easy file). */
  script: string;
  /** This object's own values for the script's props (overrides the defaults). */
  props: Record<string, unknown>;
}

export const Script = defineComponent<ScriptData>({
  type: 'Script',
  category: 'Gameplay',
  label: 'Script',
  icon: 'script',
  description: 'Runs an EasyScript (.easy) when you press Play.',
  defaults: () => ({ script: '', props: {} }),
  fields: {
    script: { kind: 'asset', label: 'Script', assetType: 'script' },
    props: { kind: 'scriptProps', label: 'Values', scriptField: 'script' },
  },
});

export interface TraitsData {
  traits: string[];
  /** This object's own values for its traits (a moving platform's offset, a coin's points). */
  props?: Record<string, unknown>;
}

export const Traits = defineComponent<TraitsData>({
  type: 'Traits',
  category: 'Gameplay',
  label: 'Traits',
  icon: 'sparkles',
  description: 'Tick a box to give this object a ready-made behavior — no code needed.',
  defaults: () => ({ traits: [], props: {} }),
  fields: {
    traits: { kind: 'traits', label: 'Traits' },
  },
});
