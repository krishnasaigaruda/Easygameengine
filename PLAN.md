# Easy Game Engine (EGE) — Master Plan

> A fully client-side, in-browser game engine + editor that lets someone with **zero experience**
> build **2D or 3D games**, including realistic open-world 3D scenes (mountains, grass, dirt paths,
> a third-person character), and export them as a **web app**.

---

## 1. Vision

| Goal | What it means for the user |
|---|---|
| **Zero experience needed** | Drag models in, click "Add Behavior", tick boxes like `climbable` / `swimmable`, press Play. |
| **2D and 3D** | One editor, two modes. 2D uses sprites/tilemaps; 3D uses models/terrain. |
| **Any kind of game** | Obby, horror / FNAF-style, platformer, top-down, racing, open world. Nothing assumes one genre: sky, fog, time of day, post-processing and camera movement are all **opt-in** components. |
| **Realistic visuals** | Physically based materials, sun + sky, soft shadows, fog, grass, terrain, post-processing — all optional, all with good defaults. |
| **3D model import** | Drop in `.glb/.gltf`, `.fbx`, `.obj` + textures. Animations inside models are detected automatically. |
| **Easy animations** | Pick "Idle / Walk / Run / Jump / Climb / Swim" from a dropdown; the engine blends them for you. |
| **Simple JSON-like coding** | **EasyScript**: `"traits": ["climbable"]`, `"on": { "touch": [...] }`. No classes, no compilers. |
| **Pre-written scripts** | A library of ready behaviors: third-person controller, door, pickup, enemy AI, checkpoint, etc. |
| **Unity-style editor** | Scene **Hierarchy**, **Inspector**, **Project/Assets** panel, **Viewport** with gizmos, **Console**. |
| **Export to web** | One click → a static folder / `.zip` / installable PWA that runs on any website. |
| **100% client-side** | No server. Projects are saved in the browser (IndexedDB), and optionally also as real files in a **project folder** you choose (Chrome/Edge). Export/import as files too. |

### Honest reality check (target image: Death Stranding–style valley)
- The **engine** can deliver: PBR lighting, HDR sky, sun shadows, height-fog, terrain with
  texture blending, thousands of instanced grass blades, rocks scattered by rules, bloom,
  tone-mapping, color grading. That covers the *look* of the reference image.
- The **realism mostly comes from assets**: photo-scanned rocks, a detailed character model,
  good textures. We'll ship a starter pack and make it one click to pull **free CC0 assets**
  (e.g. Poly Haven HDRIs/textures/models) and Mixamo-style animated characters.
- Browsers have limits (GPU memory, ~2–4 GB tabs). We'll add **Quality presets**
  (Low / Medium / High / Ultra) and automatic LODs so games still run on laptops/phones.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Safety for a big codebase. |
| Build tool | **Vite** | Fast dev server, easy static build (= our export target). |
| Editor UI | **React** + **Zustand** (state) | Panels, inspectors, drag-and-drop. |
| Panel layout | **dockview** (or flexlayout-react) | Dockable/resizable panels like Unity. |
| 3D rendering | **Three.js** (WebGPURenderer, WebGL2 fallback) | Huge ecosystem, glTF, PBR, shadows. |
| Post-processing | `postprocessing` (pmndrs) / Three TSL nodes | Bloom, SSAO, tone mapping, DOF, color grading. |
| Physics 3D | **Rapier** (`@dimforge/rapier3d-compat`, WASM) | Fast, deterministic, character controller built in. |
| Physics 2D | **Rapier 2D** | Same API style as 3D. |
| 2D rendering | Three.js orthographic camera + sprite batching | One renderer for both modes. |
| Model loading | GLTFLoader + DRACO + Meshopt + KTX2, FBXLoader, OBJLoader | Covers 99% of model files. |
| Asset optimizing | `@gltf-transform` (in a Web Worker) | Compress/resize on import so games load fast. |
| Raycast/collision speed | `three-mesh-bvh` | Fast picking in editor + mesh colliders. |
| Audio | Web Audio API (+ `howler` optional) | 3D positional sound. |
| Storage | **IndexedDB** (via `idb`) + **OPFS** for big binaries | Fully client-side projects. |
| EasyScript parsing | **JSON5** + our own validator (Zod / JSON-Schema) | Friendly JSON with comments and trailing commas. |
| Code editor (advanced) | **Monaco** with EasyScript autocomplete | For users who want to type scripts. |
| Export packaging | `fflate` (zip) | Build the exported game zip in-browser. |
| Testing | Vitest (unit), Playwright (editor E2E) | |

---

## 3. Architecture

```
┌────────────────────────── Browser Tab ───────────────────────────┐
│                                                                  │
│  EDITOR (React)                         RUNTIME (pure TS)         │
│  ┌───────────┐ ┌──────────┐            ┌──────────────────────┐  │
│  │ Hierarchy │ │Inspector │──commands─>│ World (Entities +    │  │
│  ├───────────┤ ├──────────┤            │   Components)        │  │
│  │ Viewport  │ │ Project  │<──events───│ Systems: Render,     │  │
│  ├───────────┤ ├──────────┤            │  Physics, Animation, │  │
│  │ Console   │ │ Toolbar  │            │  EasyScript, Audio,  │  │
│  └───────────┘ └──────────┘            │  Input, UI           │  │
│        │                               └──────────────────────┘  │
│        v                                          ^               │
│  Undo/Redo stack ─── Project Store (IndexedDB/OPFS) ──┘           │
│                                                                  │
│  EXPORTER: runtime bundle + scene JSON + assets ──> game.zip     │
└──────────────────────────────────────────────────────────────────┘
```

**Key rule:** the **runtime has zero editor code**. The exported game ships only the runtime +
the project data. The editor is just a tool that edits the same data the runtime plays.

### Data model (everything is JSON = easy save/export)
- **Project** → settings, list of scenes, asset database.
- **Scene** → tree of **Entities**.
- **Entity** → `id`, `name`, `parent`, list of **Components**.
- **Component** → typed data: `Transform`, `MeshRenderer`, `Light`, `Camera`, `RigidBody`,
  `Collider`, `Animator`, `Script`, `Terrain`, `Grass`, `Water`, `Sprite`, `AudioSource`, `UIElement`…
- **Prefab** → a saved entity tree you can reuse (e.g. "Pine Tree", "Enemy").

### Folder structure
```
Easygameengine/
├── PLAN.md
├── package.json              # npm workspaces
├── packages/
│   ├── runtime/              # the engine itself (no React)
│   │   ├── core/             # World, Entity, Component, Systems, Time, Events
│   │   ├── render/           # Three.js renderer, materials, lights, sky, post FX
│   │   ├── physics/          # Rapier wrappers, character controller
│   │   ├── animation/        # Animator, state machine, blending
│   │   ├── terrain/          # heightmap terrain, splat texturing, grass, scatter
│   │   ├── twod/             # sprites, tilemaps, 2D physics
│   │   ├── audio/
│   │   ├── input/            # keyboard, mouse, gamepad, touch
│   │   ├── ui/               # in-game HUD (health bar, text, buttons)
│   │   └── easyscript/       # parser, validator, interpreter, built-in actions
│   ├── behaviors/            # pre-written scripts (JSON) + their docs
│   ├── editor/               # React app: panels, gizmos, undo, asset import
│   └── exporter/             # builds web-app zip / PWA
├── templates/                # starter projects (Third-Person Valley, 2D Platformer…)
├── assets-starter/           # small CC0 starter pack
└── docs/                     # user docs, EasyScript reference
```

---

## 4. Editor Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Play] [Pause] [Stop] │ Move Rotate Scale │ 2D/3D │ Quality: High │ Export │
├──────────────┬───────────────────────────────────────────┬───────────────┤
│ HIERARCHY    │                                           │ INSPECTOR     │
│ v Scene      │                                           │ Player        │
│   Sun        │                                           │ - Transform   │
│   Sky & Fog  │              VIEWPORT                     │   Pos 0 1 0   │
│   Terrain    │     (orbit camera, gizmos, grid,          │ - Model       │
│   Grass      │      drag & drop assets here)             │   porter.glb  │
│ v Player     │                                           │ - Animator    │
│     Backpack │                                           │   Idle/Walk.. │
│   Ladder     │                                           │ - Behaviors   │
│   Lake       │                                           │  [x] Player   │
│ + Add        │                                           │  [x] Climb    │
├──────────────┴─────────────────────────┬─────────────────┤ [+ Behavior]  │
│ PROJECT / ASSETS                       │ CONSOLE         │ [+ Component] │
│ Models  Textures  Scripts  Audio       │ > Player jumped │               │
│ [rock.glb] [porter.glb] [grass.png]    │ > Saved         │               │
└────────────────────────────────────────┴─────────────────┴───────────────┘
```

**Inspector magic for beginners:**
- **Traits checkboxes**: Climbable, Swimmable, Walkable, Pickup, Breakable, Pushable, Solid, Trigger, Damaging…
- **"+ Add Behavior"** → searchable list of pre-written scripts with plain-English descriptions.
- Every property has a tooltip and a **"Reset to default"** button.
- **Visual Rule Builder**: `When [player] [touches] this → [play sound] [coin.mp3]` — it writes EasyScript for you.

---

## 5. EasyScript — the JSON-like language

Files end in `.easy` (JSON5: comments, trailing commas, unquoted keys allowed).

### 5.1 Traits (one word = a whole feature)
```json5
{
  name: "Ladder",
  traits: ["climbable"],          // player can climb it automatically
}
```
```json5
{
  name: "Lake",
  traits: ["swimmable", "water"], // player switches to swim mode inside
  props: { current: [0.5, 0, 0] } // water pushes you gently east
}
```

Built-in traits (each one maps to a pre-written behavior):
`solid`, `walkable`, `climbable`, `swimmable`, `water`, `pickup`, `collectible`, `pushable`,
`breakable`, `damaging`, `healing`, `bouncy`, `slippery`, `ladder`, `door`, `checkpoint`,
`spawn-point`, `trigger`, `npc`, `enemy`, `vehicle`, `rideable`, `light-source`, `destroy-offscreen`.

### 5.2 Properties
```json5
{
  name: "Player",
  props: {
    health: 100,
    speed: 4,
    runSpeed: 8,
    jumpHeight: 1.2,
    carryWeight: 0,
  }
}
```

### 5.3 Events → Actions (the "coding" part)
```json5
{
  name: "Coin",
  traits: ["collectible"],
  on: {
    touch: [                                    // when something touches this
      { if: "other.is('player')" },             // only the player
      { add: "game.score", value: 1 },
      { play: "sounds/coin.mp3" },
      { spawn: "prefabs/sparkle", at: "self" },
      { destroy: "self" },
    ],
  }
}
```

Events: `start`, `update`, `touch`, `untouch`, `enter`, `exit`, `click`, `key`, `timer`,
`health-zero`, `animation-end`, `message`, `seen-by-player`, `near` (with `distance`).

Actions: `set`, `add`, `subtract`, `toggle`, `move`, `moveTo`, `rotate`, `lookAt`, `spawn`,
`destroy`, `play` (sound), `animate`, `wait`, `if/else`, `repeat`, `send` (message),
`call` (function), `camera`, `ui` (show text/bar), `load-scene`, `save-game`, `vibrate`, `log`.

### 5.4 Functions (reusable steps)
```json5
{
  name: "Player",
  functions: {
    takeDamage: [
      { subtract: "self.health", value: "$amount" },
      { animate: "Hit" },
      { if: "self.health <= 0", then: [{ call: "die" }] },
    ],
    die: [
      { animate: "Death" },
      { wait: 2 },
      { load-scene: "GameOver" },
    ],
  }
}
```
Another object calls it: `{ call: "takeDamage", on: "other", args: { amount: 10 } }`.

### 5.5 Expressions (small and safe)
- Math: `+ - * / %`, comparisons, `and / or / not`.
- Paths: `self.health`, `other.name`, `game.score`, `player.position.y`, `input.jump`.
- Helpers: `random(1,10)`, `distance(self, player)`, `time.delta`, `is('tag')`.
- **No `eval`**: our own tiny expression parser → sandboxed, safe to share games.

### 5.6 Escape hatch for advanced users
`{ js: "scripts/custom.js" }` loads a plain JS module with a small API (`onStart`, `onUpdate`).
Beginners never need it.

### 5.7 Tooling
- Live validation with friendly errors: *"Line 7: 'pley' isn't an action. Did you mean 'play'?"*
- Autocomplete in Monaco from the JSON Schema.
- Hot-reload: edit a script during Play mode → changes apply instantly.

---

## 6. Pre-written Behavior Library (v1)

| Category | Behaviors |
|---|---|
| **Characters** | Third-Person Controller, First-Person Controller, 2D Platformer Controller, Top-Down Controller, Click-to-Move |
| **Movement abilities** | Climb (ladders/walls), Swim, Jump, Double-Jump, Sprint, Crouch, Carry/Backpack weight, Ledge-grab |
| **Camera** | Follow Camera (over-shoulder), Orbit Camera, 2D Follow, Cinematic Path, Camera Shake |
| **World** | Door, Elevator, Moving Platform, Teleporter, Checkpoint, Day/Night Cycle, Weather (rain/fog/wind) |
| **Items** | Pickup, Collectible, Inventory, Health Pack, Key & Lock |
| **Combat** | Health, Damage Zone, Projectile, Melee Hit, Respawn |
| **AI** | Wander, Patrol (waypoints), Chase Player, Flee, Follow, Simple NPC Dialog |
| **UI** | Health Bar, Score Counter, Timer, Dialog Box, Main Menu, Pause Menu, Game Over |
| **Effects** | Footstep sounds (by surface), Dust particles, Splash, Spawn FX |

Each behavior = an `.easy` file + a Inspector form + a 1-line description + a demo GIF.

---

## 7. Realistic Rendering Features

- **PBR materials** (base color, normal, roughness, metalness, AO), auto-detected from texture names
  (`rock_albedo.png`, `rock_normal.png`…).
- **Sky & Sun**: physical sky + HDRI environment lighting (image-based lighting), one "Time of Day" slider.
- **Shadows**: cascaded shadow maps for big outdoor scenes, soft contact shadows.
- **Atmosphere**: height fog + distance haze (that misty mountain look in the reference).
- **Terrain**: heightmap sculpt brushes (raise/lower/smooth/flatten), import real heightmaps,
  texture painting with up to 8 layers (grass, dirt, rock, path), auto-rock on steep slopes.
- **Grass & foliage**: GPU-instanced grass with wind, density painting, LOD fade.
- **Scatter tool**: paint rocks/trees/bushes with random scale/rotation.
- **Water**: lake/river surfaces with reflections, refraction, foam.
- **Post-processing**: ACES/AgX tone-mapping, bloom, SSAO, color grading, vignette, depth-of-field, motion blur, TAA/SMAA.
- **Quality presets**: Low / Medium / High / Ultra, plus "Auto" based on device FPS.
- **LOD & streaming**: auto LOD generation on import, frustum + distance culling.

---

## 8. 2D Mode

- Orthographic camera, pixels-per-unit setting, pixel-perfect option.
- Sprites, sprite sheets (auto-slice), animated sprites.
- Tilemap painter with auto-tiling.
- 2D lights & shadows, parallax backgrounds.
- 2D physics (Rapier 2D) — same traits work: `solid`, `bouncy`, `climbable`, `swimmable`.

---

## 9. Animation

- **Auto-detect clips** in imported models (`Idle`, `Walk`, `Run`…), with a fuzzy name matcher.
- **Animator component**: pick clips for standard states from dropdowns:
  Idle, Walk, Run, Jump, Fall, Land, Climb, Swim, Crouch, Carry, Hit, Death, + custom.
- **Simple state machine in EasyScript** (generated automatically by controllers):
  ```json5
  animator: {
    states: { idle: "Idle", walk: "Walk", run: "Run", climb: "Climb_Up", swim: "Swim" },
    blend: 0.2,
    rules: [
      { when: "speed > 0.1", go: "walk" },
      { when: "speed > 5",   go: "run" },
      { when: "climbing",    go: "climb" },
      { when: "inWater",     go: "swim" },
    ]
  }
  ```
- **Retargeting**: use Mixamo-rig animations on any humanoid model.
- **Timeline / keyframe editor** for simple object animations (doors, platforms, cutscenes).
- **IK basics**: feet on uneven ground (great for hiking terrain), look-at head.

---

## 10. Export

- **Export → Web App**: produces `game.zip` with `index.html`, runtime JS, compressed assets, `scene.json`.
- Options: single-folder static site, **PWA** (installable + offline), embed snippet (`<iframe>`).
- Asset pipeline at export: Draco/Meshopt meshes, KTX2 textures, strip unused assets, minify.
- Loading screen + progress bar customizable.
- **Project file**: `MyGame.egeproj` (zip) to back up/share editable projects.

---

## 11. Roadmap — Step by Step

Each phase ends with a **"Done when"** check that we can demo.

### Phase 0 — Project setup — DONE (2026-10-25)
- [x] npm workspaces monorepo (`runtime`, `behaviors`, `editor`, `exporter`)
- [x] Vite + React + TypeScript, ESLint/Prettier, Vitest
- [x] Three.js + Rapier installed, a spinning cube renders
- **Done when:** `npm run dev` opens the editor shell with a 3D cube. → editor runs at http://localhost:5300

### Phase 1 — Core runtime — DONE (2026-10-25)
- [x] World / Entity / Component / System architecture
- [x] Transform hierarchy (parent/child)
- [x] Render system (Three.js scene sync), camera, lights
- [x] Time, game loop (fixed physics step + variable render)
- [x] Event bus, input system (keyboard/mouse/gamepad/touch)
- [x] Scene JSON serialize/deserialize
- **Done when:** a scene loads from JSON and renders. → `packages/editor/src/scenes/starter.scene.json`

### Phase 2 — Editor shell — DONE (2026-10-25)
- [x] Panels: Hierarchy, Viewport, Inspector, Project, Console, Toolbar — resizable splitters (full drag-to-dock deferred to Phase 14)
- [x] Hierarchy: create, rename, delete, duplicate, drag to re-parent (keeps world position, touch-friendly), search, hide/show, right-click menu
- [x] Viewport: orbit camera, grid, click to select, Move/Rotate/Scale gizmos, snapping, F to focus, light/camera icons
- [x] Inspector: auto-generated forms for every component (drag-to-scrub numbers, sliders, colors…); "+ Add Component"
- [x] Undo/Redo (command pattern, slider/gizmo drags merge into one step), copy/cut/paste
- [x] Save/Load projects in IndexedDB; autosave; import/export `.egeproj`; recent projects
- [x] Built-in primitives: cube, sphere, plane, capsule, cylinder, cone, torus + lights + camera
- **Done when:** user can build a scene of primitives, edit properties, reload page and it's still there. → verified in Chrome

### Phase 3 — Asset import + Asset Store — DONE (2026-10-25)
- [x] Drag & drop files (or whole folders) into Project panel or Viewport; Import files/folder buttons
- [x] glTF/GLB, FBX, OBJ(+MTL) models with their textures/buffers + **animations** (clips detected, listed, auto-played, picked per object)
- [x] Textures (PNG/JPG/WebP/AVIF), HDRI skies (.hdr/.exr) with image-based lighting, audio files stored (playback in Phase 11)
- [x] Thumbnails for models, materials, skies, textures; triangle counts; auto-fit size + ground placement for new models
- [x] Auto-build PBR materials from texture name patterns (diff/nor/rough/metal/ao…)
- [x] Material editor in Inspector (tint, roughness, metalness, tiling, bumpiness, 5 texture slots); asset picker slots accept drag & drop
- [x] **Asset Store** (see §15) — 22,000+ free assets, fetched live, only downloaded when the user clicks Add
- [x] Credits recorded for every store asset (author, license, link) and shown in the Inspector
- [x] `.egeproj` is now a zip containing the scene **and all assets**; old JSON project files still open
- [ ] Optimize on import in a Web Worker (texture resize, mesh compression, LODs) → moved to Phase 12 (export) / 14
- **Done when:** user drags a `.glb` rock and character into the scene and they look right, and can add a model / texture / HDRI sky from the Asset Store. → verified in Chrome (Poly Haven rocks, HDRI sky, grass material, animated Objaverse reindeer)

### Phase 4 — Physics — DONE (2026-10-25)
- [x] RigidBody (dynamic/static/kinematic) + Collider (auto, box, sphere, capsule, cylinder, exact mesh, convex hull)
- [x] "Auto" colliders match the visible shape (incl. stretched spheres → hull, imported models → exact mesh)
- [x] "Fit to object" and "Auto shape" buttons; Inspector hides fields that don't apply
- [x] Character controller (WASD/arrows/gamepad, run, jump with buffer, slopes, auto-step, ground snap, turns to face movement, pushes crates)
- [x] Triggers / sensors (`triggerEnter`/`triggerExit`) + collision events (`collisionEnter`/`collisionExit`)
- [x] Physics debug view (Colliders toggle)
- [x] Basic Play / Stop (snapshot + exact restore, autosave paused, play-time edits temporary) — pulled forward from Phase 6
- [x] Starter Valley now has solid ground/rocks, a walkable Player, pushable crates and a bouncy ball
- **Done when:** a capsule walks over a model, bumps into rocks, falls off ledges. → 14 physics tests + verified in Chrome

### Phase 5 — EasyScript v1 — DONE (2026-10-25)
- [x] Own JSON5 parser with line/column tracking + friendly errors ("Line 7: … did you mean 'log'?")
- [x] Safe expression parser and evaluator (no `eval`, sandboxed member access)
- [x] Interpreter: 11 events, 28 actions, 22 functions, variables, if/else/guards, repeat (incl. forever), wait, smooth moves, functions with args, messages, spawn/destroy, endless-loop protection
- [x] Traits: 15 ready (solid, pushable, bouncy, slippery, trigger, player, collectible, health, damaging, healing, checkpoint, fall zone, spinning, floating, patrolling) — most written in EasyScript itself; 7 more arrive in Phase 7
- [x] Script + Traits components in the Inspector (trait checkboxes, per-object script values with reset)
- [x] Script Editor: Code view (CodeMirror, live diagnostics, spec-driven autocomplete) and Visual "When / Do" rule builder, problems list, built-in reference
- [x] Hot reload while playing; script logs appear in the Console (click to select the object)
- [x] Minimal HUD (corner text, pop-up messages) for score/health
- [x] Texture workflow: New material, drag a texture onto an object (auto-builds the material from the whole map set), "Create material" on textures
- **Done when:** the Coin example works. → 48 EasyScript tests + verified in Chrome (coins collected, score HUD, checkpoint)

### Phase 6 — Play mode — DONE (2026-10-25)
- [x] Play / Stop — snapshot scene before Play, restore after Stop (done in Phase 4)
- [x] Pause (⇧⌘P) + Step one frame (⌥⌘P); paused frames still render so you can orbit and inspect
- [x] Play in a new tab: standalone full-screen player page (`play.html`) that loads the saved project
- [x] "Made with Easy Game Engine" splash + corner badge (shared `startGame()` player, reused by export)
- [x] Live Inspector during Play: fields refresh 10×/s; "Live values" (object script variables) and "Game values" (game.*), editable on the fly
- [x] Console shows log actions and errors; click a message to select its object
- **Done when:** user presses Play, plays, presses Stop, and scene returns to edit state. → verified in Chrome (pause freezes, step = 1 frame, live values, new-tab player with branding)

### Component library + UI (requested 2026-10-25, done before Phase 7)
- [x] Unity-style Add Component menu: categories (Rendering, Camera, Physics, Gameplay, UI, Audio, Effects) + search across all, keyboard navigation
- [x] UI components: UI Text, UI Image, UI Button, UI Panel, UI Progress Bar — 9-point anchors, pixel offsets, scale-to-screen (1280×720 design size), nesting via the Hierarchy, live {formula} text, buttons run on.click / send messages, click-to-select in the editor
- [x] Audio Source (3D positional or 2D, volume, pitch, loop, play on start); EasyScript `play` / `stopSound`
- [x] Particle System (rate, burst, lifetime, speed, cone spread, size/color/opacity over life, gravity, glow) with 8 one-click presets and live editor preview; EasyScript `burst`
- [x] Label (floating camera-facing text with live formulas)
- [x] Follow Camera (third-person, mouse/right-stick look, wall avoidance) — part of Phase 7
- [x] Climbable + Water components and character climb / swim modes — part of Phase 7

### Phase 7 — Pre-written behaviors — DONE (2026-10-25)
- [x] Third-Person Controller + Follow Camera (over-the-shoulder, mouse capture / right stick, wall avoidance); Play switches to the game camera automatically
- [x] Climb (enter by walking into Climbable, W/S/A/D on the wall, Space jumps off, pulls up over the top), Swim (float chest-deep, slower, Space swims up / jumps out), Jump, Sprint, Carry
- [x] Pickup, Door, NPC (dialog), Checkpoint, Health (real health bar), Damage, Healing, Fall zone
- [x] Enemy (sees the player, walks to them with physics, attacks with cooldown); Patrolling; AI movement intents
- [x] One interaction focus: only the nearest interactable shows its prompt and reacts to E
- [x] HUD: health bar, dialog box, prompts; EasyScript actions chase / pickUp / drop / dialog / bar
- [x] Starter Valley: watchtower ladder, pond, gate, guide NPC, golem, supply crate, coins, checkpoint, score UI
- [ ] Vehicles → Phase 14
- [ ] Navmesh path-finding around obstacles (enemies currently walk straight, sliding along walls) → Phase 14
- **Done when:** a character walks, runs, jumps, climbs a climbable ladder, swims in a swimmable lake. → verified in Chrome (climbed onto the lookout deck, swam the pond, golem chased and hit)

### Phase 8 — Realistic world tools (all opt-in) — DONE (2026-10-27)
Rule: a new scene has none of this. Each is a component you add (Create > Environment, or the
Scene Settings "Add" buttons) and can delete. An always-day obby or a dark FNAF office uses none.
- [x] Sky component: physical sky with a **fixed** time of day; drives the sun light + sky lighting
- [x] Day/Night Cycle component (separate, optional) — moves the Sky's time while playing
- [x] Fog component (distance / exponential, can match the sky); scene fog off by default
- [x] Post Processing component: bloom, tone mapping, contrast/saturation/warmth, vignette, SMAA/FXAA
- [x] Sun shadows follow the camera (shadows everywhere in big scenes)
- [x] Camera Controller modes: third-person, first-person, top-down, side-view, look-around (fixed spot, FNAF-style); `useCamera` action to switch cameras
- [x] Obby kit: kill brick, moving platform, disappearing platform traits; characters ride moving/spinning platforms
- [x] Sky rebuilt: blended time-of-day looks (dawn / day / sunset / night), each optionally its own skybox (HDRI), stars, moon, clouds
- [x] Terrain: one-click generator (hills, mountains, valley, island, plateaus), sculpt (raise / lower / smooth / flatten) and paint brushes, 4 material layers, auto rock & snow, heightfield physics
- [x] Shader materials: water (procedural or real wave textures), ocean, lava, glass, ice, toon, unlit, hologram, force field, neon, low-poly, chrome/gold/plastic/rubber
- [x] Grass (instanced, wind, painted) and plants / rocks / trees (painted or scattered, instanced)
- [x] Looks (Post Processing): cartoon outlines, retro (big pixels, fewer colours), film grain; one-click looks
      Realistic / Cartoon / Retro / Horror / Noir. The look stays on Low quality (only glow and smoothing go) — 2026-10-27
- [x] Quality presets (Low / Medium / High / Ultra)
- [~] Cascaded shadows: not done on purpose. Sun shadows follow the camera instead; three.js cascades would need every
      material patched, which the grass / plant / terrain shaders can't take without double lighting
- [x] Terrain: generator, sculpt brushes, texture painting, heightmap import ("From an image" in Landscape) — 2026-10-27
- [x] Water surface: Create > Environment > Water (swimmable pool with the water shader) — 2026-10-27
- [x] Post-processing stack
- Fixed on the way: three reversed GLSL smoothsteps (vignette, particle dots, stars) that drew wrongly on some GPUs
- **Done when:** we can recreate a scene like the reference image (mountain valley, grass, dirt path, haze).

### Sample games (built to test the engine; also "New from template")
Sky Obby, Night Shift (horror), Valley Explorer (open world), Toon Arena (top-down), Side Runner (2.5D).
Each has headless gameplay tests. Building them led to: character launch/knockback, jump pads, death/kill
counters, enemy rewards, side-view axis lock, same-frame spawning, lamp intensity scale, formula previews
in the editor, the bright-editing toggle, and one-project-per-tab saving.
What they still need (next): animated characters instead of capsules (Phase 9), prefabs instead of hidden
template objects for spawning, grass/scatter for the valley, sounds, a flashlight for horror, toon outlines.

### Phase 9 — Animation
- [x] Animator component with standard state dropdowns + auto clip detection (idle / walk / run / in the air, picked from how fast the object moves; walk on the spot; face where it walks) — 2026-10-25
- [x] Blending; any controller or script that moves an object drives it automatically
- [x] State rules: attack / hurt / defeated clips, played by `{ animate: "'attack'" }` and by the health / enemy traits — 2026-10-26
- [x] Borrow animations from another model ("Animations from"), matched by bone names (Mixamo, Rigify, `_L`/`Left`…) — 2026-10-26
- [~] Feet on slopes: the body lowers so the lower foot touches (no knee bending / two-bone IK yet)
- [x] Keyframes component + timeline for simple object animations (doors, lifts, platforms) — 2026-10-26
- [x] **Rig & animate** (like Mixamo, in the browser): skeleton fitted inside any model (drag joints, left/right mirrored),
      automatic skin weights (Mesh2Motion's solver, MIT), 178 free CC0 animations (human; also four-legged, horse, bird,
      dragon, monster, spider, snake, fish skeletons), saved as an animated model — 2026-10-26
- [x] **Animation Studio** (one window, three steps): 1. what is it (human, four legs, horse, bird, dragon, monster,
      spider, snake, fish), 2. drag the points to fit, 3. animate: drag points (the limb bends to follow, keys are made
      for you), drag keys along the timeline, edit copies of ready-made clips, loop/length — 2026-10-26
- [x] Automatic fitting: every point moves into the middle of its body part (rays across the limb), too-long limbs
      are pulled back inside; simple hands by default; Mesh2Motion-style dragging (snaps to the middle of the part
      under the mouse, points after it follow, one side shown when mirrored) — 2026-10-26
- [x] **Code points**: markers on an animation's timeline that send the object a message (on.message) when reached
      (footsteps, the hit frame of an attack); saved with the model — 2026-10-26
- [x] Animator swims and climbs: Swimming / Floating / Climbing / Holding on slots with sample clips found by name
      (climbing plays backwards going down) — 2026-10-26
- **Done when:** the imported character idles, walks, runs, climbs, swims with smooth blends.

### Phase 10 — Full 2D engine — DONE (2026-10-27)
A complete 2D engine, not a 3D scene seen from the side.
- [x] **New project: 3D or 2D** from the Hub; each starts with the right camera, gizmos, Create menu, Asset Store tabs
      (2D: Images, Effects, Sounds, Music) and templates; 3D models and skies can't be imported into a 2D project
- [x] 2D editor: flat (orthographic) view, X/Y gizmos, drag objects on the plane, snapping grid
- [x] Pixels per meter (Scene Settings; pixel-art sprites and tiles are sized by their pixels) and Pixel perfect
      (whole-number zoom, camera moves in whole screen pixels)
- [x] Sprites, sprite sheets (frames found by themselves when a picture is set; Auto-detect), frame animations
      (named runs of frames; characters play idle / walk / run / jump / fall by themselves; scripts use `animate`)
- [x] Tilemap painter (Create > 2D > Tilemap): tileset palette, single tiles or 3 × 3 auto-tiling (edges and corners
      by themselves), erase with Shift, one stroke = one undo, painted tiles solid (merged into boxes per row)
- [x] 2D physics: the 3D physics locked to the flat plane (same traits and components)
- [x] 2D lights (Create > 2D > Light: colour, reach, brightness, flicker; Scene Settings: Darkness), parallax
      backgrounds (Sprite: Distance; Create > 2D > Background), particles work in 2D. [~] 2D shadows: not done
      (lights glow through walls)
- [x] 2D Platformer controller (2D Player), Top-down controller (Top-down Player: 4 directions, no falling), follow camera
- [x] Remove background for pictures (Inspector / Sprite)
- [x] 2D templates (Tutorial 2D, 2D Parkour) and 2D export
- **Done when:** a new 2D project can make a platformer with coins, enemies, a tilemap level and UI, without touching 3D.

### Phase 11 — Audio & in-game UI
- [x] AudioSource (2D/3D), music — done early (see Component library)
- [x] Footsteps by surface type: Surface component (wood, stone…) and a footsteps sound per terrain layer — 2026-10-26
- [x] UI components (text, bars, images, buttons, panels) — done early
- [x] Ready-made menus (Create > Menus): main menu, pause menu (Esc / P / Start), game over (health trait sends
      "playerDied"); plain UI + an editable script. Script actions pause / resume / restart, game.paused — 2026-10-26
- **Done when:** the game has a main menu, HUD, and sound.

### Phase 12 — Export
- [x] Runtime-only production bundle: `ege-player.js` (engine only, one file, ~2.5 MB gzipped, most of it the physics
      WASM), built by `npm run build:player` (runs before dev/build) — 2026-10-26
- [x] Export to `game.zip` (index.html, ege-player.js, game.json, assets/), installable app option (manifest +
      network-first service worker, works offline), README with how to run it locally and put it online — 2026-10-26
- [x] Loading screen with real progress (bytes of every file) — 2026-10-26
- [x] **One-file export** (game.html, double-click to play): engine, game and every file inside one page — 2026-10-26
- [x] Smaller games: unused assets left out of the export; models are compacted when imported (each repeated part
      kept once, copies just placed; pictures JPEG unless really see-through, max 2048 px); **Optimize** button for
      models already in a project (safe: new copy, objects switched over, undoable). Viking house 27.2 → 8.7 MB — 2026-10-26
- [x] Screen UI hidden in the editor camera view (shows in the game camera view, while playing, or when a UI object
      is selected), so full-screen menus don't cover the scene — 2026-10-26
- [ ] Mesh compression (Draco/meshopt) and texture compression (KTX2)
- [x] **"Made with Easy Game Engine"** splash on start + small corner badge (built in Phase 6, `startGame()`)
- [x] Auto-generated **Credits** screen (button by the badge): every store asset's author, licence, source, link;
      a texture set counts once — 2026-10-26
- **Done when:** exported zip unzipped onto any static host runs the game.

### Phase 13 — Templates & onboarding — DONE (2026-10-26)
- [x] **Project Hub** (opens with the editor): New 3D / New 2D project, templates, every project (open, rename,
      save as file, delete), open a project file or folder. The project menu is down to the essentials.
- [x] Templates made in the editor (public/templates): **Tutorial 3D**, **Tutorial 2D**, **Forest** (player model,
      trees, path), **2D Parkour** (stone platforms, moving platform, jump pad, coins, checkpoint, fall zone, star)
- [x] Interactive tutorials: a guide panel whose steps tick themselves off (look around, select, play, collect,
      stop, add, move, give it a trait, play again)
- [x] **Learn** tab: guide pages for every feature + a reference generated from the engine (components, traits,
      script actions / events / words, shortcuts), with search
- [x] **Credits & licences** tab: libraries, adapted code, asset sources, and what's legal (handled vs your part)
- [x] 2D basics (the rest of Phase 10 stays for later): flat camera, Sprite (picture/shape, tiling, mirror, pixel
      art, layers), 2D create menu, physics on the plane, characters face the camera and mirror
- [x] Saved games: save / load / deleteSave actions, hasSave(); ready-made menus use them (Save game, Continue)
- [x] Per-object trait values (Traits > values under each ticked trait)
- [x] credits.json in every project (a form in the Inspector) + "Made by" credit for your own imports
- **Done when:** a total beginner finishes a playable game from a template without help.

### Phase 14 — Polish & performance — DONE (2026-10-27)
- [x] Profiler panel (Profiler tab next to Console): FPS, frame time graph, game/drawing split, time per engine part, draw calls, triangles, meshes, textures, shaders, memory, plain tips when something is heavy
- [x] Web Workers / instancing: zipping (export, project files) runs in workers (fflate), physics is WASM, plants and grass are GPU-instanced, and while playing, 4+ copies of the same still model are drawn as one instanced batch per part (each copy culled and moved on its own; Forest template: 102 → 13 draw calls)
- [x] Touch controls on phones/tablets (editor Play, Play in new tab and exports): stick (push fully to run), Jump / Run / Use / Fire / Pause, plus a button for every other key the game's scripts use; drag to look, tap to click; Scene Settings switch to turn them off
- [x] Accessibility: icon buttons get spoken names from their tooltips, visible keyboard focus, menus work with arrow keys, dialogs marked as dialogs, reduced motion respected
- [x] E2E tests (`npm run test:e2e`, Playwright in Chrome, own server on port 5320, fresh profile): Hub, undo/redo, Play/Stop restore, tutorial guide, 2D movement, docs search, one-file export opened from disk

### Phase 15 — In-browser AI assistant (started 2026-10-27, on the user's go)
- [x] AI button (toolbar) opens a sidebar. Download once (asks first, shows the exact size), then works offline from
      the browser cache; optionally also saved to a folder (Load from a folder skips the download)
- [x] Runs locally on the GPU: WebLLM in a Web Worker, Qwen2.5 0.5B (small, ~270 MB) or 1.5B (smarter, ~830 MB),
      f16 or f32 build picked by the graphics chip
- [x] Static hosting: `npm run build` packs the model (scripts/pack-ai-model.mjs) by tensor into files under 24 MB;
      the one larger tensor (word table) is cut into parts the editor joins on download. Falls back to Hugging Face
- [x] Acts through the same editor actions a person uses: create / row / edit (move, turn, size, colour, rename) /
      any component setting / add & remove components / traits / delete / duplicate / parent / Asset Store import /
      use project assets / scripts (checked by the EasyScript compiler) / scene settings / looks. Its answer is
      forced into that list (JSON schema), so it can only touch the project; each request is one undo step
- [x] Shows every step (and any script it writes) while it runs; Stop anytime; Undo the whole request
- [ ] Attach things to a request (images need a vision-capable model; files and pasted text)
- [x] Clear fallback when the device can't run it (no WebGPU): the sidebar says so, nothing breaks
- **Done when:** on a static host, "make a small obby with 5 platforms and a finish flag" builds a playable scene in the editor.

---

## 12. MVP Definition (first big milestone = Phases 0–7 + basics of 8–9)

> "Open the editor → choose **Third-Person Valley** template → drag in a character `.glb` →
> tick `climbable` on a ladder and `swimmable` on a lake → press Play → walk, climb, swim →
> click **Export** → get a web game."

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Browser performance for realistic scenes | Quality presets, LODs, instancing, KTX2 textures, auto-quality. |
| WebGPU not everywhere | WebGL2 fallback path, test both. |
| Large assets fill browser storage | OPFS for binaries, storage-usage meter, compress on import. |
| FBX/odd model files break | Prefer glTF; convert FBX on import; clear error messages. |
| EasyScript too limited | Visual builder for beginners, `js` escape hatch for advanced users. |
| Scope is huge | Strict phase order; every phase produces a usable demo. |

---

## 15. Asset Store

Sources: Built-in shader materials (no download) · Poly Haven (CC0, live API) · ambientCG (2,000+ CC0
materials, prebuilt index) · Objaverse (40,000 CC0/CC-BY models, prebuilt index) · Smithsonian 3D
(2,400 CC0 museum scans via Objaverse-XL) · three.js water wave textures (MIT). Search ranks whole words,
plurals and synonyms; removed models are hidden automatically.

Fully client-side: the browser talks straight to public, CORS-enabled sources. Nothing is bundled
in the engine; an asset is only downloaded into the user's project when they click **Add**.

| Source | Content | License filter | Size |
|---|---|---|---|
| **Objaverse** (allenai/objaverse on Hugging Face, models from Sketchfab) | 3D models incl. animated characters/creatures | Only **CC0** and **CC-BY** (no NC / SA / ND, no age-restricted) | ~20,000 curated (of ~800K) |
| **Poly Haven** (api.polyhaven.com) | Models, PBR texture sets, HDRI skies | **CC0** | ~2,400 (live API) |

- A compact **catalog index** (names, authors, licenses, tags, thumbnail links — no asset files) is
  generated once by a Node script (`scripts/build-objaverse-catalog.mjs`) and lazy-loaded when the
  store opens, so search is instant. Poly Haven is queried live.
- Filters: type, category, "Animated only", license, polygon budget (web-friendly).
- Every imported store asset remembers source, author, license and link → Credits screen + export.
- Verified 2026-10-25: Poly Haven API + files and Hugging Face GLBs send `Access-Control-Allow-Origin`.
  ambientCG does **not** (would need a server) → excluded.

---

## 14. Next Immediate Steps
1. Phase 0: scaffold the monorepo, get a cube rendering in the editor shell.
2. Phase 1: core ECS + scene JSON.
3. Phase 2: Hierarchy + Inspector + gizmos + save/load.

---

## 16. Product style

- Professional, minimal UI. **No emojis** anywhere (UI, engine messages, docs).
- Icons come from the Lucide SVG set; engine definitions refer to icons by name.
