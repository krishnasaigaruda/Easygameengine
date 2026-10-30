/*
 * The entry of ege-player.js, the engine-only bundle that exported games run on (no editor).
 * Built by `npm run build:player` into the editor's public/runtime folder.
 */
import { playExportedGame } from './exported';

const container = document.getElementById('game') ?? document.body;

playExportedGame(container).catch((err: unknown) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#d8dce3;background:#121417;font:15px system-ui,sans-serif';
  el.textContent = `The game could not start: ${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(el);
});
