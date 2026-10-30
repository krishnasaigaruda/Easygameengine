import { Engine } from '../core/Engine';
import type { AssetResolver } from '../assets/types';
import { addBadge, addCredits, showSplash, type GameCredit } from './Branding';

export interface StartGameOptions {
  container: HTMLElement;
  /** Scene JSON (as saved by the editor). */
  scene: unknown;
  /** Where asset files come from. */
  assets: AssetResolver;
  /** Show the "Made with Easy Game Engine" splash and corner badge. */
  branding?: boolean;
  /** Authors and licences of the assets, for the Credits screen. */
  credits?: GameCredit[];
  /** The game's name (scripts read it as game.title). */
  title?: string;
}

/**
 * Runs a game outside the editor: loads the scene and its assets, looks through the scene's
 * main camera, and starts playing. Used by "Play in new tab" and by exported games.
 */
export async function startGame(options: StartGameOptions): Promise<Engine> {
  const { container, branding = true } = options;
  const splash = branding ? showSplash(container) : Promise.resolve();
  const engine = new Engine({ container });
  engine.assets.resolver = options.assets;
  await engine.init();
  engine.loadScene(options.scene);
  if (options.title && engine.scripts) engine.scripts.gameDefaults.title = options.title;
  if (options.title) engine.gameId = options.title.toLowerCase().replace(/[^\w]+/g, '-');
  engine.useSceneCamera = true;
  engine.start(); // render behind the splash so the first frame is ready
  await splash;
  engine.setPlaying(true);
  if (branding) addBadge(container);
  addCredits(container, options.credits ?? []);
  return engine;
}
