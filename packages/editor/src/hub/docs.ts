import {
  ACTIONS,
  ENTITY_METHODS,
  ENTITY_PROPS,
  EVENTS,
  FUNCTIONS,
  INPUT_ACTIONS,
  KEY_NAMES,
  TRAITS,
  ROOT_NAMES,
  allComponentDefs,
} from '@ege/runtime';
import { SHORTCUTS, formatKeys } from '../editor/keymap';

/*
 * The documentation shown in the Hub. Guide pages are written here; the reference pages (every
 * component, trait, script action, event, function and shortcut) are built from the engine's own
 * definitions, so they always match what's in the editor.
 */

export type DocBlock =
  | { h: string }
  | { p: string }
  | { list: string[] }
  | { code: string }
  | { tip: string }
  | { table: [string, string][] };

export interface DocPage {
  id: string;
  title: string;
  icon: string;
  group: 'Start' | 'Build' | 'Gameplay' | 'Share' | 'Reference';
  blocks: DocBlock[];
}

const GUIDES: DocPage[] = [
  {
    id: 'start',
    title: 'Getting started',
    icon: 'flag',
    group: 'Start',
    blocks: [
      { p: 'Easy Game Engine makes 3D and 2D games in your browser. Nothing is installed and nothing is uploaded: your projects are saved in this browser (and, if you like, in a folder on your computer).' },
      { h: 'The Hub' },
      { list: ['New 3D project: an empty world with ground, sun, sky light and a camera.', 'New 2D project: a side-on world seen flat (no perspective), for platformers and puzzle games.', 'Templates: ready-made projects to start from. The tutorials open a step-by-step guide that ticks itself off as you go.', 'Your projects: open, rename, save as a project file, or delete. "Open a project file" brings in a .egeproj someone sent you.'] },
      { h: 'The editor' },
      { table: [['Hierarchy (left)', 'Every object in the scene. Drag to put one inside another. The eye hides it.'], ['Viewport (middle)', 'The world. Click to select, drag to move. "Game camera" shows what players will see.'], ['Inspector (right)', "The selected object's components: what it is and does. Every field can also be changed from code (the hint under each component shows how)."], ['Project (bottom left)', 'Your assets: models, textures, materials, sounds, scripts. The Asset Store has free ones.'], ['Console (bottom)', 'Messages: what happened, warnings, script logs.']] },
      { h: 'Saving' },
      { p: 'Everything saves by itself a moment after each change (the toolbar says "Saved"). Project menu (click the project name):' },
      { list: ['Choose project folder: also keep the project as files on your computer (Chrome / Edge).', 'Export project file: one .egeproj file with the scene and every asset, to back up or share.', 'Projects: back to the Hub.'] },
      { tip: 'Browser storage can be cleared by the browser if your disk is very full. For work you care about, choose a project folder or export a project file now and then.' },
    ],
  },
  {
    id: 'navigate',
    title: 'Moving around',
    icon: 'move',
    group: 'Start',
    blocks: [
      { table: [['Right mouse + move', 'Look around (hold it and use WASD to fly, Q/E down/up, wheel while flying: speed)'], ['Alt + left drag', 'Orbit around the point you look at'], ['Middle drag (or the Hand tool)', 'Pan'], ['Drag an object (Move tool)', 'Slide it along the ground; the arrows move it along one direction'], ['Mouse wheel', 'Zoom'], ['F (or double-click in the Hierarchy)', 'Frame the selected object']] },
      { p: '2D projects look straight at the flat world: right or middle drag (or the Hand tool) pans, the wheel zooms. There is no turning. Drag an object to move it.' },
      { p: 'The editor remembers where its camera was for each project.' },
    ],
  },
  {
    id: 'objects',
    title: 'Objects & components',
    icon: 'box',
    group: 'Build',
    blocks: [
      { p: 'A game is made of objects. Each object has components: a Transform (where it is), and whatever else it needs (a shape, a model, a light, physics, a script…).' },
      { h: 'Making objects' },
      { list: ['Create (top of the Hierarchy): shapes, lights, cameras, environment (terrain, sky, fog, day/night), UI and ready-made menus. In 2D projects: Sprite, Circle, Platform and 2D Player.', 'Drag a model, picture or sound from the Project panel into the viewport.', 'Add Component (bottom of the Inspector) gives an object more abilities.'] },
      { h: 'Editing' },
      { table: [['Move / Rotate / Scale (W E R)', 'Gizmo tools. Drag an object itself to slide it over the ground and other objects.'], ['Snap (G)', 'Move and turn in steps.'], ['Cmd/Ctrl+D', 'Duplicate'], ['Cmd/Ctrl+C, X, V', 'Copy, cut, paste'], ['Delete', 'Delete'], ['Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z', 'Undo, redo (everything in the editor)']] },
      { list: ['Tags (under the name) group objects for scripts: closest("enemy"), count("coin").', 'The checkbox next to the name turns an object off (hidden and inactive).', 'Put objects inside others in the Hierarchy: children move with their parent.'] },
    ],
  },
  {
    id: 'assets',
    title: 'Assets & the Asset Store',
    icon: 'shop',
    group: 'Build',
    blocks: [
      { p: 'Import by dragging files onto the editor: models (.glb .gltf .fbx .obj), pictures (.png .jpg .webp), skies (.hdr .exr) and sounds (.mp3 .ogg .wav).' },
      { h: 'Asset Store' },
      { p: 'Tens of thousands of free models, materials, skies, sounds, music and pictures, searched live. Nothing downloads until you click Add. Each asset keeps its author and licence; CC-BY ones go into your game\'s Credits screen by themselves.' },
      { list: ['3D Models / Animated: community models (Sketchfab via Objaverse) and museum scans (Smithsonian).', 'Materials: realistic surfaces from Poly Haven and ambientCG (colour, normal, roughness, height…).', 'Skies (HDRI): real skies that also light the scene.', 'Sounds and Music: from Openverse (Freesound, Jamendo…). Images: from Wikimedia Commons.', 'Remove background (on any picture in the Inspector, or on a Sprite): makes the background see-through. It finds the background colours from the edges; click anything else you want gone.'] },
      { h: 'Smaller files' },
      { list: ['New models are compacted when added: each repeated part is kept once and pictures are saved compactly.', 'Models already in a project: Optimize in their Inspector (makes a new copy and switches the objects to it; undo switches back).'] },
      { h: 'Materials' },
      { p: 'New > Material in the Project panel, then drag it onto an object. Textures dropped together are matched by name (diffuse, normal, roughness, metal, AO, height).' },
    ],
  },
  {
    id: 'world',
    title: 'Terrain, nature & sky',
    icon: 'mountain',
    group: 'Build',
    blocks: [
      { list: ['Terrain: sculpt (raise, lower, smooth, flatten), paint up to 8 layers of ground textures (with Breakup for natural patches), and pick a footsteps sound per layer.', 'Grass: short blades, or a 3D grass model, around the camera.', 'Plants / Scatter: trees, bushes, rocks, flowers, fallen leaves and pebbles painted or spread over the terrain (models work too).', 'Terrain from a picture: Landscape > From an image (heightmap). White is the highest ground, black the lowest.', 'Sky, Fog (with height fog), Day/Night Cycle and Post Processing are optional components.', 'Water: Create > Environment > Water makes a pool to swim in. Lower the ground under it (Terrain > Lower) to make it deep.'] },
      { h: 'Looks' },
      { p: 'Post Processing has one-click looks: Realistic, Cartoon (outlines around everything), Retro (big pixels, fewer colours), Horror (cold, dark edges, grain) and Noir (black and white). Each setting can be changed after.' },
      { p: 'Quality (Low…Ultra, bottom of the viewport) changes sharpness, shadows, grass and draw distance. The look stays on every quality.' },
    ],
  },
  {
    id: 'characters',
    title: 'Characters & animation',
    icon: 'activity',
    group: 'Build',
    blocks: [
      { list: ['Select a model, then "Make it the player" (walks with WASD, the camera follows) or "Make it a character" (for villagers and enemies).', 'Animator: plays idle, walk, run, jump, swim, climb, and attack / hurt / defeated when asked. Each slot finds a clip by its name; pick another in the Inspector.', 'Camera Controller: third person, first person (C switches in games that allow it), top-down, side view, or look-around.'] },
      { h: 'Animation Studio' },
      { list: ['1. What is it? Human, four legs, horse, bird, dragon, monster, spider, snake or fish.', '2. Fit the points: they fit themselves; drag any that are off (over the model a point drops into the middle of that body part).', '3. Animate: preview 178 free animations (tick the ones to keep), or make your own: drag a point and the limb follows, a key is made for you, drag keys along the timeline.', 'Code points: flags on the timeline that send the object a message when the animation reaches them (footsteps, the hit of a sword).', 'Models that already have animations open straight at step 3, with the free library added (unticked) if they have a human skeleton.', 'Undo / redo: Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z.'] },
      { h: 'Keyframes' },
      { p: 'For objects that aren\'t characters (doors, lifts, platforms): add a Keyframes component, move the object, and add keys on its timeline.' },
    ],
  },
  {
    id: 'traits',
    title: 'Gameplay without code',
    icon: 'sparkles',
    group: 'Gameplay',
    blocks: [
      { p: 'Traits are ready-made behaviours: add a Traits component and tick them. Each is a small script you can read (and copy into your own).' },
      { tip: 'Every trait is listed in Reference > Traits.' },
      { h: 'Physics' },
      { list: ['Rigid Body: static (never moves), dynamic (falls, gets pushed) or kinematic (moved by scripts).', 'Collider: the shape it bumps with. "Auto" matches what you see. Trigger colliders notice things without blocking them.', 'Character Controller: walking, running, jumping, slopes and steps.', 'The Colliders button (bottom of the viewport) shows the invisible shapes.'] },
    ],
  },
  {
    id: 'scripting',
    title: 'EasyScript',
    icon: 'script',
    group: 'Gameplay',
    blocks: [
      { p: 'Scripts say what happens and when. They\'re plain lists of actions, with a visual editor and a code view (Script component > Edit script).' },
      { code: `{
  // Values this object remembers: self.speed, set / add them.
  props: { speed: 2 },

  on: {
    start: [ { log: "Hello from {self.name}!" } ],
    touch: [
      { if: "other.is('player')" },
      { add: "game.score", value: 1 },
      { destroy: "self" },
    ],
    key: { e: [ { say: "You pressed E" } ] },
    message: { opened: [ { show: "Treasure" } ] },
  },

  functions: {
    blink: [ { hide: "self" }, { wait: 0.2 }, { show: "self" } ],
  },
}` },
      { list: ['Text in {curly braces} is worked out while playing: "Score: {game.score}".', 'game.* values are shared by every script; self.* belong to this object.', 'Any component field can be read and changed: Door.Light.intensity, self.UIText.text, find("Sun").Light.color.', 'Wait pauses only that list of actions; the rest of the game carries on.'] },
      { tip: 'Every action, event, function and expression word is in Reference > Script actions and Script words.' },
    ],
  },
  {
    id: 'ui',
    title: 'UI, menus & sound',
    icon: 'mouse',
    group: 'Gameplay',
    blocks: [
      { list: ['UI elements (Create > UI): Text, Button, Panel, Image, Progress Bar, Ring Meter. They stick to a corner (Anchor) and scale with the screen; "Fill the screen" covers it.', 'Formulas in UI text update while playing: "Health {round(player.health)}".', 'Buttons run their object\'s on.click and can send a message to every script.', 'Ready-made menus (Create > Menus): Main Menu (the game waits behind it), Pause Menu (Esc / P / Start), Game Over (shows when the player runs out of health, or when a script sends "gameOver"). They\'re plain UI plus a script you can change.', 'Script actions pause, resume and restart control the game; game.paused and game.title can be read.'] },
      { h: 'Saving the game' },
      { list: ['{ save: "\'game\'" } keeps the game in a slot: game values, where every object is, their own values, and what has gone (collected coins, defeated enemies).', '{ load: "\'game\'" } puts it back; hasSave(\'game\') says whether there is one; { deleteSave: "\'game\'" } forgets it.', 'Saves stay in the player\'s browser, separately for each game. Saves made while testing in the editor don\'t mix with the exported game\'s.', 'The ready-made Pause Menu has a Save game button, and the Main Menu shows Continue when there\'s a save.'] },
      { h: 'Sound' },
      { list: ['Audio Source: a sound on an object (3D: quieter with distance).', 'Music: background music that cross-fades.', 'Footsteps: a Character Controller sound, a Surface component on floors (wood, stone) or a sound per terrain layer.'] },
      { p: 'In the editor, screen UI shows in the Game camera view, while playing, or when a UI object is selected.' },
    ],
  },
  {
    id: '2d',
    title: '2D games',
    icon: 'square',
    group: 'Gameplay',
    blocks: [
      { list: ['Make a 2D project from the Hub. The camera is flat (Camera > Flat (2D), View height = how many meters fit top to bottom).', 'Sprites: a picture or a plain square / circle. Size in meters, Repeat picture for ground and walls, Mirror, Pixel art, and Layer (higher is in front).', 'Everything with physics stays on the flat plane; characters face the camera and mirror when they walk left.', 'Create > 2D Player makes a player and points the camera at it (side view). A / D or arrows to walk, Space to jump.', 'Traits work the same in 2D: collectible, kill zone, checkpoint, moving platform, jump pad…', 'Drag an object to move it on the flat plane. Right or middle drag pans the view.'] },
      { h: 'Sprite sheets and animation' },
      { p: 'Give a sprite a picture that is a grid of frames and the frames are found by themselves (or use Auto-detect frames, or set Columns and Rows). Under Sprite sheet, name runs of frames as animations. A character plays idle, walk, run, jump and fall by itself as it moves; scripts can play any animation with animate.' },
      { h: 'Tilemaps' },
      { p: 'Create > 2D > Tilemap, pick a Tileset picture (its tile grid is found by itself), then paint in the viewport with the left mouse button. Shift erases; Esc stops painting. Auto-tile uses a 3 × 3 block of the tileset (corners, edges, middle) so painted ground gets its grass top and edges by itself; Single tile paints exactly the tile you click. Painted tiles are solid.' },
      { p: 'Remove background (on a picture in the Inspector, or on a Sprite) makes a picture\'s background see-through.' },
      { h: 'More 2D' },
      { list: ['Top-down Player (Create > 2D): walks up, down, left and right with no falling, for games seen from above.', 'Background (Create > 2D): a far-away picture. Its Distance (0 near, 1 as far as the sky) makes it scroll slower than the level: layer a few for depth.', 'Light (Create > 2D): lights up sprites and tilemaps around it (colour, reach, brightness, flicker for torches). Scene Settings: Darkness sets how dark the rest is.', 'Pixels per meter (Scene Settings): pixel-art pictures and tiles are sized by their pixels, so they all match. Pixel perfect keeps every pixel the same size on screen.'] },
    ],
  },
  {
    id: 'play',
    title: 'Playing & testing',
    icon: 'play',
    group: 'Share',
    blocks: [
      { list: ['Play (or Cmd/Ctrl+P) runs the game in the viewport. Stop puts everything back as it was.', 'Pause and Step freeze the game and move one frame at a time.', 'Play in new tab: full screen, exactly like players see it.', 'Esc stops the game; if the game uses Esc itself (a pause menu), Shift+Esc stops it.', 'Changes while playing are temporary.'] },
      { h: 'Profiler' },
      { p: 'The Profiler tab (next to Console) shows how fast the game runs: frames per second, how long each frame takes, how much goes to the game and how much to drawing, which parts of the engine take the most time, and counts like draw calls and triangles. When something is heavy it says what to try.' },
      { h: 'Phones and tablets' },
      { p: 'On a touch screen the game gets on-screen controls by itself: a stick to walk (push it all the way to run), Jump, Run and Use buttons, Fire when the game has weapons, and pause. Every other key your scripts use (on key "c", on key "q"…) gets its own button too. Drag anywhere else to turn the camera; a quick tap is a click. Turn them off in Scene Settings (Touch controls).' },
    ],
  },
  {
    id: 'export',
    title: 'Exporting & sharing',
    icon: 'upload',
    group: 'Share',
    blocks: [
      { p: 'Export (top right) makes your game a website. Two kinds:' },
      { list: ['Website folder (game.zip): unzip and upload to any website host (Netlify Drop, GitHub Pages, itch.io as an HTML game…). Loads fastest; can be an installable app that works offline.', 'One file (game.html): double-click to play, or send to friends. Best for small games (everything is inside one file).'] },
      { p: 'To try the website folder on your computer, serve it: in a terminal in the folder run python3 -m http.server 8000 (or npx serve), then open http://localhost:8000.' },
      { list: ['Assets the game doesn\'t use are left out.', 'A Credits screen lists every author and licence; the open-source licences of the engine come in THIRD-PARTY-NOTICES.txt.', 'Exported games show "Made with Easy Game Engine".'] },
    ],
  },
  {
    id: 'ai',
    title: 'AI assistant',
    icon: 'sparkles',
    group: 'Build',
    blocks: [
      { p: 'AI (top right) opens the assistant. Tell it what to make or change: "make a small obby with 5 platforms and a finish", "add 5 coins in a row", "make Step 3 red", "make it look like a cartoon". It works through the editor like you do: create, place, move, turn, size, colour, rename, duplicate, group, delete, any component setting, traits, scripts, Asset Store imports, your project\'s assets, scene settings and looks. Each step is shown as it runs; Stop stops it, and Undo takes the whole request back.' },
      { list: ['It runs on this computer\'s graphics chip (WebGPU: Chrome or Edge). What you type never leaves your computer.', 'Download it once (Small about 270 MB, Smarter about 830 MB). It is kept in the browser and works offline after. Keep it also in a folder to load it again without downloading (Load from a folder).', 'Small models make mistakes: check what it did, undo and ask again in other words. Short, clear requests work best.'] },
      { h: 'Putting it on your own site' },
      { p: 'npm run build includes the small model, split into files under 24 MB, so it works on static hosts like Cloudflare Pages (files up to 25 MB). Without it (EGE_SKIP_AI_MODEL=1), the assistant downloads the model from Hugging Face instead.' },
    ],
  },
  {
    id: 'trouble',
    title: 'Troubleshooting',
    icon: 'alert',
    group: 'Share',
    blocks: [
      { table: [['"Open in another tab"', 'A project can be edited in one tab at a time. Click "Use here" to move it to this tab.'], ['Storage full', 'Delete unused assets (right-click > Delete) or old projects in the Hub.'], ['A model is huge or tiny', 'Fit to height in its Model component, or the Scale fields.'], ['Something falls through the floor', 'The floor needs a Collider (Add Component > Collider).'], ['A script does nothing', 'The Console shows its warnings; the script editor marks problems.']] },
    ],
  },
];

/** Reference pages, from the engine's own definitions. */
function reference(): DocPage[] {
  const comps = allComponentDefs()
    .filter((d) => d.label)
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.label.localeCompare(b.label));
  const byCat = new Map<string, typeof comps>();
  for (const d of comps) byCat.set(d.category ?? 'Other', [...(byCat.get(d.category ?? 'Other') ?? []), d]);
  const componentBlocks: DocBlock[] = [];
  for (const [cat, list] of byCat) {
    componentBlocks.push({ h: cat });
    componentBlocks.push({ table: list.map((d) => [d.label, d.description ?? '']) });
  }

  const traitCats = new Map<string, typeof TRAITS>();
  for (const t of TRAITS.filter((x) => !(x as { comingIn?: string }).comingIn)) traitCats.set(t.category, [...(traitCats.get(t.category) ?? []), t]);
  const traitBlocks: DocBlock[] = [];
  for (const [cat, list] of traitCats) {
    traitBlocks.push({ h: cat });
    traitBlocks.push({ table: list.map((t) => [t.label, t.description]) });
  }

  const actCats = new Map<string, typeof ACTIONS>();
  for (const a of ACTIONS) actCats.set(a.category, [...(actCats.get(a.category) ?? []), a]);
  const actionBlocks: DocBlock[] = [];
  for (const [cat, list] of actCats) {
    actionBlocks.push({ h: cat });
    actionBlocks.push({ table: list.map((a) => [`${a.label} · ${JSON.stringify(a.example).replace(/"([a-zA-Z]+)":/g, '$1: ')}`, a.description + (a.comingIn ? ` (coming in ${a.comingIn})` : '')]) });
  }

  return [
    { id: 'ref-components', title: 'Components', icon: 'box', group: 'Reference', blocks: [{ p: 'Everything Add Component offers.' }, ...componentBlocks] },
    { id: 'ref-traits', title: 'Traits', icon: 'sparkles', group: 'Reference', blocks: [{ p: 'Ready-made behaviours (Traits component).' }, ...traitBlocks] },
    {
      id: 'ref-events',
      title: 'Script events',
      icon: 'zap',
      group: 'Reference',
      blocks: [
        { p: 'When a list of actions runs: on: { start: [ … ], touch: [ … ] }.' },
        { table: EVENTS.map((e) => [e.key, e.description]) },
        { h: 'Keys for on.key' },
        { p: `Any letter or digit, ${Object.keys(KEY_NAMES).join(', ')}, and these input actions (keyboard and gamepad): ${INPUT_ACTIONS.join(', ')}.` },
      ],
    },
    { id: 'ref-actions', title: 'Script actions', icon: 'script', group: 'Reference', blocks: [{ p: 'Everything a script can do. The example shows the shortest way to write it.' }, ...actionBlocks] },
    {
      id: 'ref-words',
      title: 'Script words',
      icon: 'file',
      group: 'Reference',
      blocks: [
        { h: 'Names' },
        { table: Object.entries(ROOT_NAMES) },
        { h: 'Every object has' },
        { table: [...Object.entries(ENTITY_PROPS), ...Object.entries(ENTITY_METHODS)] },
        { h: 'Functions' },
        { table: FUNCTIONS.map((f) => [f.signature, f.description]) },
        { h: 'Operators' },
        { p: '+ - * / %, comparisons (== != < > <= >=), and / or / not, and a ? b : c.' },
      ],
    },
    { id: 'ref-shortcuts', title: 'Keyboard shortcuts', icon: 'keyboard', group: 'Reference', blocks: [{ table: SHORTCUTS.map((s) => [formatKeys(s.keys), `${s.label} (${s.group})`]) }] },
  ];
}

let cached: DocPage[] | null = null;
export function docPages(): DocPage[] {
  return (cached ??= [...GUIDES, ...reference()]);
}
