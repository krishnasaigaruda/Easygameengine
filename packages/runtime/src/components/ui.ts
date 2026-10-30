import { defineComponent, type FieldSpec, type Vec2 } from '../core/Component';

export const UI_ANCHORS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;
export type UIAnchor = (typeof UI_ANCHORS)[number];

/** Position/size shared by every UI element (in pixels of a 1280×720 screen; scales to fit). */
export interface UILayout {
  /** Which point of the screen (or of the parent panel) this sticks to. */
  anchor: UIAnchor;
  /** Pixels from the anchor: x to the right, y down. */
  offset: Vec2;
  /** Width × height in pixels (0 = fit the content). */
  size: Vec2;
  /** Cover the whole screen (or the parent panel), whatever its shape: backdrops, menus. */
  fill?: boolean;
}

const layoutFields = {
  anchor: { kind: 'enum', label: 'Anchor', options: UI_ANCHORS },
  offset: { kind: 'vec2', label: 'Offset', step: 1, axes: ['X', 'Y'] },
  size: { kind: 'vec2', label: 'Size', step: 1, axes: ['W', 'H'] },
  fill: { kind: 'boolean', label: 'Fill the screen (or parent)' },
} satisfies Record<string, FieldSpec>;

const layout = (anchor: UIAnchor, offset: Vec2, size: Vec2): UILayout => ({ anchor, offset, size });

export interface UITextData extends UILayout {
  /** Text to show. {formulas} update while playing: "Score: {game.score}". */
  text: string;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  shadow: boolean;
}

export const UIText = defineComponent<UITextData>({
  type: 'UIText',
  label: 'UI Text',
  icon: 'file',
  category: 'UI',
  description: 'Text on the screen. Use {formulas} for live values, like Score: {game.score}.',
  defaults: () => ({
    ...layout('top-left', [24, 24], [0, 0]),
    text: 'Score: {game.score or 0}',
    fontSize: 28,
    color: '#ffffff',
    align: 'left',
    bold: true,
    shadow: true,
  }),
  fields: {
    text: { kind: 'formula', label: 'Text', insert: 'text' },
    fontSize: { kind: 'number', label: 'Font size', min: 6, max: 200, step: 1 },
    color: { kind: 'color', label: 'Color' },
    align: { kind: 'enum', label: 'Align', options: ['left', 'center', 'right'] },
    bold: { kind: 'boolean', label: 'Bold' },
    shadow: { kind: 'boolean', label: 'Shadow' },
    ...layoutFields,
  },
});

export interface UIImageData extends UILayout {
  /** Texture asset. */
  image: string;
  tint: string;
  opacity: number;
  cornerRadius: number;
}

export const UIImage = defineComponent<UIImageData>({
  type: 'UIImage',
  label: 'UI Image',
  icon: 'image',
  category: 'UI',
  description: 'A picture on the screen: logos, icons, crosshairs, portraits.',
  defaults: () => ({ ...layout('center', [0, 0], [128, 128]), image: '', tint: '#ffffff', opacity: 1, cornerRadius: 0 }),
  fields: {
    image: { kind: 'asset', label: 'Image', assetType: 'texture' },
    tint: { kind: 'color', label: 'Tint' },
    opacity: { kind: 'number', label: 'Opacity', min: 0, max: 1, step: 0.01 },
    cornerRadius: { kind: 'number', label: 'Corner radius', min: 0, max: 200, step: 1 },
    ...layoutFields,
  },
});

export interface UIButtonData extends UILayout {
  label: string;
  fontSize: number;
  color: string;
  textColor: string;
  cornerRadius: number;
  /** Also tell every script this happened: they react in on.message. '' = none. */
  sendMessage: string;
}

export const UIButton = defineComponent<UIButtonData>({
  type: 'UIButton',
  label: 'UI Button',
  icon: 'mouse',
  category: 'UI',
  description: 'A clickable button. Runs this object\'s on.click, and can send a message to all scripts.',
  defaults: () => ({
    ...layout('center', [0, 0], [220, 56]),
    label: 'Start',
    fontSize: 20,
    color: '#e0b23a',
    textColor: '#1b1d22',
    cornerRadius: 8,
    sendMessage: '',
  }),
  fields: {
    label: { kind: 'formula', label: 'Label', insert: 'text' },
    sendMessage: { kind: 'string', label: 'Send message' },
    fontSize: { kind: 'number', label: 'Font size', min: 6, max: 120, step: 1 },
    color: { kind: 'color', label: 'Color' },
    textColor: { kind: 'color', label: 'Text color' },
    cornerRadius: { kind: 'number', label: 'Corner radius', min: 0, max: 100, step: 1 },
    ...layoutFields,
  },
});

export interface UIPanelData extends UILayout {
  color: string;
  opacity: number;
  cornerRadius: number;
  /** Soft blur behind the panel (frosted glass). */
  blur: boolean;
}

export const UIPanel = defineComponent<UIPanelData>({
  type: 'UIPanel',
  label: 'UI Panel',
  icon: 'square',
  category: 'UI',
  description: 'A box that holds other UI. Put UI objects inside it in the Hierarchy (menus, dialogs).',
  defaults: () => ({ ...layout('center', [0, 0], [420, 280]), color: '#121417', opacity: 0.8, cornerRadius: 12, blur: true }),
  fields: {
    color: { kind: 'color', label: 'Color' },
    opacity: { kind: 'number', label: 'Opacity', min: 0, max: 1, step: 0.01 },
    cornerRadius: { kind: 'number', label: 'Corner radius', min: 0, max: 200, step: 1 },
    blur: { kind: 'boolean', label: 'Blur behind' },
    ...layoutFields,
  },
});

export interface UIProgressBarData extends UILayout {
  /** Formula for how full it is, 0 to 1: "player.health / 100". */
  value: string;
  /** Text above the bar (can use {formulas}). */
  label: string;
  color: string;
  background: string;
  cornerRadius: number;
  /** A straight bar, or a ring that fills around (the label goes in the middle). */
  shape: 'bar' | 'ring';
  /** Ring width as a fraction of its size. */
  thickness: number;
}

export const UIProgressBar = defineComponent<UIProgressBarData>({
  type: 'UIProgressBar',
  label: 'UI Progress Bar',
  icon: 'gauge',
  category: 'UI',
  description: 'Fills from 0 to 1: health, stamina, loading, timers, cooldowns. A straight bar or a ring.',
  defaults: () => ({
    ...layout('top-right', [-24, 24], [240, 12]),
    value: 'player.health / player.maxHealth',
    label: 'Health',
    color: '#e0645a',
    background: '#3a3f4a',
    cornerRadius: 6,
    shape: 'bar',
    thickness: 0.14,
  }),
  fields: {
    shape: { kind: 'enum', label: 'Shape', options: ['bar', 'ring'] },
    value: {
      kind: 'formula',
      label: 'Value (0 to 1)',
      insert: 'expression',
      presets: [
        { label: 'Player health', value: 'player.health / player.maxHealth' },
        { label: 'Coins collected out of 10', value: 'game.coins / 10' },
        { label: 'Score out of 100', value: 'game.score / 100' },
        { label: 'Time left out of 60 s', value: 'game.timeLeft / 60' },
        { label: 'Enemies left (out of 5)', value: "count('enemy') / 5" },
      ],
    },
    label: { kind: 'formula', label: 'Label', insert: 'text' },
    color: { kind: 'color', label: 'Fill color' },
    background: { kind: 'color', label: 'Background' },
    cornerRadius: { kind: 'number', label: 'Corner radius', min: 0, max: 50, step: 1 },
    thickness: { kind: 'number', label: 'Ring width', min: 0.02, max: 0.5, step: 0.01 },
    ...layoutFields,
  },
});

export const UI_TYPES = [UIPanel.type, UIImage.type, UIButton.type, UIProgressBar.type, UIText.type];
