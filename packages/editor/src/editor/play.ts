import { Camera, type SceneData } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { saveNow } from './project';
import { viewportController } from '../viewport/viewportRef';

let snapshot: SceneData | null = null;
/** View before Play, restored on Stop. */
let viewBeforePlay = false;
const state = () => useEditor.getState();

/** Start the game: physics runs, characters move. The scene is restored on stop. */
export async function play(): Promise<void> {
  const s = state();
  if (!s.engine || s.playing) return;
  await saveNow(); // nothing pending gets lost if the tab closes mid-play
  snapshot = s.engine.saveScene();
  s.setPlaying(true);
  if (s.engine.scripts) s.engine.scripts.gameDefaults.title = s.projectName;
  // Saves made while testing in the editor stay apart from the exported game's.
  s.engine.gameId = `editor-${s.projectId}`;
  s.engine.setPlaying(true);
  // Play the game the way players see it: through the scene's own camera, if it has one.
  viewBeforePlay = s.gameView;
  if ([...s.engine.world.query(Camera)].some((e) => e.activeInHierarchy)) s.setGameView(true);
  viewportController()?.setPlaying(true);
  s.log('info', 'Playing. WASD or arrow keys to move, Shift to run, Space to jump. Press Stop (or Esc; Shift+Esc if the game uses Esc) to return.');
}

/** Does the running game use Esc itself (a pause menu)? Then Shift+Esc stops. */
export function gameUsesEscape(): boolean {
  return state().engine?.scripts?.listensFor(['escape', 'pause']) ?? false;
}

/** Stop the game and put the scene back exactly as it was before Play. */
export function stop(): void {
  const s = state();
  if (!s.engine || !s.playing) return;
  s.engine.setPlaying(false);
  const selection = s.selection;
  if (snapshot) {
    // Still flagged "playing" here, so autosave ignores the restore.
    s.engine.loadScene(snapshot);
    snapshot = null;
  }
  viewportController()?.setPlaying(false);
  s.setPlaying(false);
  s.setGameView(viewBeforePlay);
  if (selection && s.engine.world.getById(selection)) s.select(selection);
  s.log('info', 'Stopped. Scene restored to its state before Play.');
}

/** Open the game full-screen in its own tab, exactly as players will see it. */
export async function playInNewTab(): Promise<void> {
  const s = state();
  if (!s.projectId) return;
  if (s.playing) stop();
  await saveNow(); // the player page reads the saved project
  window.open(`${import.meta.env.BASE_URL}play.html?project=${encodeURIComponent(s.projectId)}`, '_blank');
}

/** Freeze / unfreeze game time while playing. */
export function togglePause(): void {
  const s = state();
  if (!s.engine || !s.playing) return;
  const on = !s.paused;
  s.engine.setPaused(on);
  s.setPaused(on);
  s.log('info', on ? 'Paused. Inspect anything, then Resume or Step one frame.' : 'Resumed.');
}

/** While paused: advance exactly one frame. */
export function stepFrame(): void {
  const s = state();
  if (!s.engine || !s.playing) return;
  if (!s.paused) {
    s.engine.setPaused(true);
    s.setPaused(true);
  }
  s.engine.stepFrame();
}

export function togglePlay(): void {
  if (state().playing) stop();
  else void play();
}
