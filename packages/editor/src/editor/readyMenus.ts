import { newId, type EntityData } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { createScript } from '../assets/library';
import { CreateEntityCommand } from '../commands/commands';
import { runCommand } from './actions';

/*
 * Ready-made menus. Each is plain UI (a Panel, Texts, Buttons) plus a menu script you can read and
 * change. Buttons send a message ("startGame", "resumeGame", "restartGame"); the script does the rest.
 */

export type ReadyMenu = 'main' | 'pause' | 'gameOver';

export const READY_MENUS: Record<ReadyMenu, { label: string; icon: string }> = {
  main: { label: 'Main Menu', icon: 'flag' },
  pause: { label: 'Pause Menu', icon: 'pause' },
  gameOver: { label: 'Game Over', icon: 'alert' },
};

const at = (anchor: string, offset: [number, number], size: [number, number]) => ({ anchor, offset, size });

const ui = (name: string, components: Record<string, object>, children: EntityData[] = [], enabled = true): EntityData => ({
  id: newId(),
  name,
  enabled,
  components: { Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, ...components },
  children,
});

const title = (text: string, y: number, size = 64) =>
  ui('Title', { UIText: { ...at('center', [0, y], [900, 0]), text, fontSize: size, color: '#ffffff', align: 'center', bold: true, shadow: true } });

const button = (name: string, label: string, y: number, message: string, primary = true) =>
  ui(name, {
    UIButton: {
      ...at('center', [0, y], [260, 56]),
      label,
      fontSize: 20,
      color: primary ? '#e0b23a' : '#2b2f36',
      textColor: primary ? '#1b1d22' : '#ffffff',
      cornerRadius: 8,
      sendMessage: message,
    },
  });

/** A screen-filling backdrop. */
const screen = (name: string, color: string, opacity: number, children: EntityData[], enabled: boolean) =>
  ui(name, { UIPanel: { ...at('center', [0, 0], [1280, 720]), fill: true, color, opacity, cornerRadius: 0, blur: true } }, children, enabled);

function build(kind: ReadyMenu, root: string): { screen: EntityData; script: string } {
  const screenName = `${root} Screen`;
  if (kind === 'main') {
    return {
      screen: screen(screenName, '#0d0f12', 0.72, [title("{game.title or 'My Game'}", -110, 72), button('Play Button', 'Play', 20, 'startGame'), button('Continue Button', 'Continue', 90, 'continueGame', false), ui('Hint', { UIText: { ...at('bottom', [0, -40], [900, 0]), text: 'WASD to move · Space to jump · Esc to pause', fontSize: 16, color: '#c9ccd1', align: 'center', bold: false, shadow: true } })], true),
      script: `{
  // The main menu: it shows when the game starts, and the game waits behind it.
  // Play sends "startGame"; Continue (only there when there's a saved game) sends "continueGame".
  // Change the title by setting game.title, or edit the Title text.
  on: {
    start: [
      { show: "${screenName}" },
      { if: "not hasSave('game')", then: [ { hide: "Continue Button" } ] },
      { pause: true },
    ],
    message: {
      startGame: [
        { hide: "${screenName}" },
        { resume: true },
      ],
      continueGame: [
        { hide: "${screenName}" },
        { resume: true },
        { load: "'game'" },
      ],
    },
  },
}
`,
    };
  }
  if (kind === 'pause') {
    return {
      screen: screen(screenName, '#0d0f12', 0.6, [title('Paused', -150), button('Resume Button', 'Resume', -40, 'resumeGame'), button('Save Button', 'Save game', 30, 'saveGame', false), button('Restart Button', 'Restart', 100, 'restartGame', false)], false),
      script: `{
  // The pause menu: Esc or P (or Start on a gamepad) pauses and carries on.
  // Its buttons send "resumeGame", "saveGame" and "restartGame". The main menu's Continue loads the save.
  on: {
    key: {
      pause: [ { call: "togglePause" } ],
    },
    message: {
      resumeGame: [ { call: "close" } ],
      saveGame: [ { save: "'game'" }, { say: "Game saved" } ],
      restartGame: [ { restart: true } ],
    },
  },
  functions: {
    togglePause: [
      { if: "self.menuOpen", then: [ { call: "close" } ], else: [ { if: "not game.paused" }, { call: "open" } ] },
    ],
    open: [
      { set: "self.menuOpen", to: true },
      { show: "${screenName}" },
      { pause: true },
    ],
    close: [
      { set: "self.menuOpen", to: false },
      { hide: "${screenName}" },
      { resume: true },
    ],
  },
}
`,
    };
  }
  return {
    screen: screen(screenName, '#2a0d0d', 0.7, [title('Game Over', -110), ui('Score Text', { UIText: { ...at('center', [0, -30], [700, 0]), text: 'Score: {game.score or 0}', fontSize: 26, color: '#ffffff', align: 'center', bold: false, shadow: true } }), button('Try Again Button', 'Try again', 50, 'restartGame')], false),
    script: `{
  // The game over screen: it shows when the player runs out of health (the "health" trait sends
  // "playerDied"), or when any script sends "gameOver". "Try again" sends "restartGame".
  on: {
    message: {
      playerDied: [ { call: "show" } ],
      gameOver: [ { call: "show" } ],
      restartGame: [ { restart: true } ],
    },
  },
  functions: {
    show: [
      { show: "${screenName}" },
      { pause: true },
    ],
  },
}
`,
  };
}

/** Add a ready-made menu: its screen (UI you can restyle) and a script that runs it. */
export async function createReadyMenu(kind: ReadyMenu): Promise<string | null> {
  const { engine, select, log } = useEditor.getState();
  if (!engine) return null;
  const existing = new Set(engine.world.roots.map((e) => e.name));
  let name = READY_MENUS[kind].label;
  for (let i = 2; existing.has(name); i++) name = `${READY_MENUS[kind].label} ${i}`;
  const { screen: screenData, script } = build(kind, name);
  const scriptId = await createScript(`${name} Script`, script);
  if (!scriptId) return null;
  const data = ui(name, { Script: { script: scriptId, props: {} } }, [screenData]);
  if (!runCommand(new CreateEntityCommand(data, null))) return null;
  select(data.id);
  log('info', `Added ${name}. Press Play to try it. Restyle it like any UI; its script is "${name} Script".`, data.id);
  return data.id;
}
