/**
 * The on-disk scene format. Plain JSON so it's easy to read, diff, save and export.
 * Entities are nested like the Hierarchy panel shows them.
 */

export const SCENE_FORMAT_VERSION = 1;

export interface SceneSettings {
  /** Background color, used when there's no sky. */
  background: string;
  /** Old scene-wide fog (kept so older scenes still look the same). New scenes use a Fog component. */
  fog: { enabled: boolean; color: string; near: number; far: number };
  /** HDRI sky: lights the scene realistically (image-based lighting) and can be the background. */
  environment: { asset: string; intensity: number; showAsBackground: boolean; blur: number };
  /** Overall brightness of the camera image. */
  exposure: number;
  /** A 3D game, or a 2D one (seen from the side, everything on one flat plane). */
  dimension?: '3d' | '2d';
  /** On-screen controls on phones and tablets (on unless turned off). */
  touchControls?: boolean;
  /** 2D: how many picture pixels make one meter (new pixel-art sprites get this size). */
  pixelsPerUnit?: number;
  /** 2D pixel art: every picture pixel is a whole number of screen pixels (no shimmer or uneven pixels). */
  pixelPerfect?: boolean;
  /** 2D lights: how dark it is where no light reaches (0 = daylight, 1 = black). */
  darkness2D?: number;
}

export interface EntityData {
  id: string;
  name: string;
  enabled?: boolean;
  tags?: string[];
  /** Component type → component data. */
  components: Record<string, object>;
  children?: EntityData[];
}

export interface SceneData {
  format: 'ege-scene';
  version: number;
  name: string;
  settings: SceneSettings;
  entities: EntityData[];
}

export function defaultSceneSettings(): SceneSettings {
  return {
    background: '#a9c4dc',
    fog: { enabled: false, color: '#a9c4dc', near: 30, far: 150 },
    environment: { asset: '', intensity: 1, showAsBackground: true, blur: 0 },
    exposure: 1,
  };
}
