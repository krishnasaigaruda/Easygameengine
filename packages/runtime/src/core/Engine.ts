import * as THREE from 'three';
import { loadPhysics } from './loadPhysics';
import { PhysicsSystem } from '../physics/PhysicsSystem';
import { ScriptSystem } from '../easyscript/ScriptSystem';
import { CameraSystem } from '../render/CameraSystem';
import { UISystem } from '../ui/UISystem';
import { UIButton } from '../components/ui';
import { AudioSystem } from '../audio/AudioSystem';
import { EffectsSystem } from '../render/EffectsSystem';
import { EnvironmentSystem } from '../render/EnvironmentSystem';
import { TerrainSystem } from '../render/TerrainSystem';
import { GrassSystem } from '../render/GrassSystem';
import { ScatterSystem } from '../render/ScatterSystem';
import { WeaponSystem } from '../render/WeaponSystem';
import { PostFX } from '../render/PostFX';
import { isFlat, setFlat } from '../render/flatCamera';
import { setShadowMapSize } from '../render/RenderSystem';

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];
/** What each quality level changes. */
export const QUALITY: Record<QualityLevel, { pixelRatio: number; shadow: number; grass: number; draw: number; post: boolean }> = {
  low: { pixelRatio: 1, shadow: 1024, grass: 0.3, draw: 0.5, post: false },
  medium: { pixelRatio: 1, shadow: 2048, grass: 0.6, draw: 0.75, post: true },
  high: { pixelRatio: 1.25, shadow: 2048, grass: 1, draw: 1, post: true },
  ultra: { pixelRatio: 2, shadow: 4096, grass: 1.4, draw: 1.4, post: true },
};
/** Phones and small machines start on Medium. */
function defaultQuality(): QualityLevel {
  if (typeof navigator === 'undefined') return 'high';
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return mobile || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'medium' : 'high';
}
import { shaderTime } from '../render/shaders';
import { Hud } from '../ui/Hud';
import { Time } from './Time';
import { World } from './World';
import { RenderSystem } from '../render/RenderSystem';
import { ModelSystem } from '../render/ModelSystem';
import { KeyframeSystem } from '../render/KeyframeSystem';
import { AssetManager } from '../assets/AssetManager';
import { Input } from '../input/Input';
import { defaultSceneSettings, type SceneData, type SceneSettings } from '../scene/SceneData';
import { loadSceneInto, parseScene, serializeWorld } from '../scene/serialize';
import { Surface } from '../components/audio';
import { Terrain } from '../components/terrain';
import { SpriteSystem } from '../render/SpriteSystem';
import { browserSaves } from '../easyscript/saveGame';
import { addTouchControls, isTouchScreen } from '../player/TouchControls';
import { InstancingSystem } from '../render/InstancingSystem';
import { TilemapSystem } from '../render/TilemapSystem';
import { Light2DSystem } from '../render/Light2DSystem';
import type { Entity } from './Entity';

export interface EngineOptions {
  /** Element the canvas is placed into. The canvas resizes to fill it. */
  container: HTMLElement;
  /** Physics steps per second. */
  physicsHz?: number;
}

type FrameCallback = (engine: Engine) => void;

/**
 * The heart of the runtime: owns the renderer, the World (entities + systems), input,
 * the physics world and the game loop. The editor and exported games both create one.
 */
export interface EngineProfile {
  fps: number;
  frameMs: number;
  /** Game logic (scripts, physics sync, animation…) and drawing, per frame. */
  updateMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  shaders: number;
  objects: number;
  /** JavaScript memory in use (Chrome / Edge only). */
  heapMB: number | null;
  systems: { name: string; ms: number }[];
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Free camera used when the scene has no camera, or when the editor wants its own view. */
  readonly camera: THREE.PerspectiveCamera;
  readonly time: Time;
  readonly world = new World();
  readonly render: RenderSystem;
  readonly models: ModelSystem;
  readonly instancing: InstancingSystem;
  readonly tilemaps: TilemapSystem;
  readonly keyframes: KeyframeSystem;
  readonly sprites: SpriteSystem;
  /** Loads models/textures/skies. Set `assets.resolver` to say where asset files live. */
  readonly assets = new AssetManager();
  readonly input: Input;
  /** Available after `init()` resolves. */
  physics!: PhysicsSystem;
  /** Runs EasyScript while playing. Available after `init()`. */
  scripts!: ScriptSystem;
  /** Follow cameras. Available after `init()`. */
  cameras!: CameraSystem;
  /** Guns, bows and swords (set up in init, like physics). */
  weapons!: WeaponSystem;
  /** Screen UI (text, buttons, panels…). */
  readonly ui: UISystem;
  /** Sounds. */
  readonly audio: AudioSystem;
  /** Particles and floating labels. */
  readonly effects: EffectsSystem;
  /** Terrain heightmaps (sculpt, paint, heights for physics). */
  readonly terrain: TerrainSystem;
  /** Grass blades on terrains and grounds. */
  readonly grass: GrassSystem;
  /** Trees, rocks and bushes spread over an area. */
  readonly scatter: ScatterSystem;
  /** Optional Sky / Fog / Post Processing / Day-Night components. */
  readonly environment: EnvironmentSystem;
  private readonly postfx: PostFX;
  /** On-screen text for games (score, messages). */
  readonly hud: Hud;
  /** When true (play mode / exported game) render through the scene's main Camera entity. */
  useSceneCamera = false;

  /** True while the game is running (physics simulates, characters move). */
  get playing(): boolean {
    return this.physics?.simulating ?? false;
  }

  private _quality: QualityLevel = defaultQuality();
  private fpsSmoothed = 60;

  /** Frames per second (smoothed) and triangles drawn last frame. */
  get stats(): { fps: number; triangles: number } {
    return { fps: Math.round(this.fpsSmoothed), triangles: this.renderer.info.render.triangles };
  }

  private readonly profileTimes = { update: 0, render: 0, frame: 16 };

  /** Turn the profiler's measurements on (they cost a little, so off by default). */
  setProfiling(on: boolean): void {
    this.world.profiling = on;
    if (!on) this.world.timings.clear();
  }

  /** What the profiler shows: frame times, what was drawn, memory, and each system's share. */
  profile(): EngineProfile {
    const info = this.renderer.info;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    return {
      fps: Math.round(this.fpsSmoothed),
      frameMs: this.profileTimes.frame,
      updateMs: this.profileTimes.update,
      renderMs: this.profileTimes.render,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      shaders: info.programs?.length ?? 0,
      objects: this.world.size,
      heapMB: heap ? heap.usedJSHeapSize / 1048576 : null,
      systems: [...this.world.timings].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms),
    };
  }

  get quality(): QualityLevel {
    return this._quality;
  }

  /** Low / Medium / High / Ultra: sharpness, shadows, grass, draw distance, post effects. */
  setQuality(q: QualityLevel): void {
    if (!QUALITY[q]) return;
    this._quality = q;
    const s = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.pixelRatio));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    setShadowMapSize(s.shadow, this.scene);
    this.grass.refresh();
  }

  setPlaying(on: boolean): void {
    this._paused = false;
    this._gamePaused = false;
    this.restartRequested = false;
    // Restart goes back to this.
    this.startSnapshot = on ? this.saveScene() : null;
    this.stepRequested = false;
    this.physics?.setSimulating(on);
    void this.scripts?.setRunning(on);
    this.cameras?.setRunning(on);
    this.keyframes.setRunning(on);
    this.instancing.setRunning(on);
    this.ui.playing = on;
    this.audio.setRunning(on);
    this.effects.playing = on;
    this.effects.reset();
    this.environment.playing = on;
    this.environment.resetTime();
    if (this.weapons) {
      this.weapons.reset();
      this.weapons.playing = on;
    }
    if (!on && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    // Phones and tablets: on-screen controls while playing (unless the game turns them off).
    this.touchControls?.remove();
    this.touchControls = null;
    if (on && this._settings.touchControls !== false && isTouchScreen()) {
      const fire = [...this.world.all()].some((e) => e.has('Weapon'));
      this.touchControls = addTouchControls(this.container, this.input, { fire, hidden: () => this._gamePaused, keys: () => this.scripts?.usedKeys() ?? [] });
    }
  }
  private touchControls: { remove(): void } | null = null;

  private readonly onCanvasClick = (): void => {
    if (!this.playing || this._gamePaused || !this.cameras?.wantsPointerLock()) return;
    if (document.pointerLockElement === this.renderer.domElement) return;
    try {
      void this.renderer.domElement.requestPointerLock()?.catch?.(() => {});
    } catch {
      /* not allowed here (e.g. iframe without permission): mouse-drag still works */
    }
  };

  /** Game time is frozen (the view still renders, so you can look around and inspect). */
  get paused(): boolean {
    return this._paused;
  }

  setPaused(on: boolean): void {
    this._paused = on && this.playing;
    this.stepRequested = false;
  }

  /** Paused by the game itself (a menu or pause screen): the world stands still, UI and keys still work. */
  get gamePaused(): boolean {
    return this._gamePaused;
  }

  setGamePaused(on: boolean): void {
    this._gamePaused = on && this.playing;
    // Free the mouse for the menu.
    if (this._gamePaused && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }

  /** Start the game again from how it was when Play started. */
  restart(): void {
    if (!this.playing || !this.startSnapshot) return;
    const snapshot = this.startSnapshot;
    this.setPlaying(false);
    this.loadScene(snapshot);
    this.setPlaying(true);
  }

  /** While paused: advance the game by exactly one frame. */
  stepFrame(): void {
    if (this.playing && this._paused) this.stepRequested = true;
  }

  /** The entity under a point on the canvas (pixels from its top-left), seen by the active camera. */
  pickEntity(x: number, y: number) {
    const el = this.renderer.domElement;
    const ndc = new THREE.Vector2((x / el.clientWidth) * 2 - 1, -(y / el.clientHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.activeCamera);
    for (const hit of ray.intersectObject(this.render.root, true)) {
      if (hit.object.userData.editorOnly) continue;
      let visible = true;
      // Copies drawn instanced are hidden but still there.
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (!o.visible && !o.userData.egeInstanced) visible = false;
      if (!visible) continue;
      const e = this.render.entityFromObject(hit.object);
      if (e) return e;
    }
    return undefined;
  }
  sceneName = 'Untitled';
  private _settings: SceneSettings = defaultSceneSettings();

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly updateCallbacks = new Set<FrameCallback>();
  private readonly fixedCallbacks = new Set<FrameCallback>();
  private rafId = 0;
  /** At most this many frames a second (0 = as many as the screen shows). The editor lowers it while its AI assistant uses the graphics chip. */
  maxFps = 0;
  private lastTime = 0;
  private running = false;
  private disposed = false;
  /** Tells games apart for saved games (exported games: their title; the editor: the project). */
  gameId = 'game';
  private _paused = false;
  private _gamePaused = false;
  private restartRequested = false;
  private startSnapshot: SceneData | null = null;
  private stepRequested = false;
  private readonly sizeScratch = new THREE.Vector2();

  constructor(options: EngineOptions) {
    this.container = options.container;
    this.time = new Time(1 / (options.physicsHz ?? 60));

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.high.pixelRatio));
    // Count triangles over the whole frame (post-processing renders several passes).
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
    this.camera.position.set(6, 5, 10);
    this.camera.lookAt(0, 0, 0);

    this.render = new RenderSystem(this.scene, this.assets);
    this.world.addSystem(this.render);
    this.terrain = new TerrainSystem(this.render, this.assets);
    this.world.addSystem(this.terrain);
    this.grass = new GrassSystem(this.render, this.terrain, { camera: () => this.activeCamera, amount: () => QUALITY[this._quality].grass, assets: this.assets });
    this.world.addSystem(this.grass);
    this.scatter = new ScatterSystem(this.render, this.terrain, this.assets, () => this.activeCamera, () => QUALITY[this._quality].draw);
    this.world.addSystem(this.scatter);
    this.models = new ModelSystem(this.render, this.assets);
    this.keyframes = new KeyframeSystem(this.render);
    this.sprites = new SpriteSystem(this.render, this.assets, () => this.activeCamera);
    this.world.addSystem(this.sprites);
    this.tilemaps = new TilemapSystem(this.render, this.assets);
    this.world.addSystem(this.tilemaps);
    this.world.addSystem(new Light2DSystem(this.render, () => this._settings.darkness2D ?? 0, () => this.activeCamera));
    this.world.addSystem(this.models);
    this.world.addSystem(this.keyframes);
    this.instancing = new InstancingSystem(this.render, this.models, () => this.activeCamera);
    this.world.addSystem(this.instancing);
    this.settings = this._settings;
    this.input = new Input(window, this.renderer.domElement);
    if (getComputedStyle(this.container).position === 'static') this.container.style.position = 'relative';
    this.hud = new Hud(this.container);
    this.ui = new UISystem(this.container, {
      assets: this.assets,
      format: (t, e) => this.scripts?.formatText(t, e) ?? t,
      evaluate: (f, e) => this.scripts?.evaluateNumber(f, e) ?? 0,
      lookup: (f, e) => this.scripts?.evaluateEntity(f, e) ?? null,
      camera: () => this.activeCamera,
    });
    this.ui.onClick = (e) => this.scripts?.clickUI(e, e.get(UIButton)?.sendMessage ?? '');
    this.world.addSystem(this.ui);
    this.audio = new AudioSystem(this.scene, this.render, this.assets, () => this.activeCamera);
    this.world.addSystem(this.audio);
    this.effects = new EffectsSystem(this.scene, this.render, {
      camera: () => this.activeCamera,
      viewportHeight: () => this.renderer.domElement.height,
      format: (t, e) => this.scripts?.formatText(t, e) ?? t,
    });
    this.world.addSystem(this.effects);
    this.environment = new EnvironmentSystem(this.scene, this.render, {
      renderer: this.renderer,
      assets: this.assets,
      camera: () => this.activeCamera,
      settings: () => this._settings,
    });
    this.world.addSystem(this.environment);
    this.postfx = new PostFX(this.renderer);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  /** Loads WASM modules (physics). Must be awaited before `start()`. */
  async init(): Promise<this> {
    const rapier = await loadPhysics();
    if (this.disposed) return this;
    this.physics = new PhysicsSystem(rapier, this.render, {
      terrain: (id) => this.terrain.heightmap(id),
      scatter: (e) => this.scatter.placements(e),
      input: this.input,
      camera: () => this.activeCamera,
    });
    this.world.addSystem(this.physics);
    // Feet on slopes: what's under a foot (ignoring the character's own capsule).
    const down = new THREE.Vector3(0, -1, 0);
    this.models.onClipEvent = (e, message) => this.scripts?.deliver(e, message);
    this.models.moveMode = (e) => (this.physics?.isSwimming(e) ? 'swim' : this.physics?.isClimbing(e) ? 'climb' : 'walk');
    this.models.groundAt = (x, z, fromY, ignore) => {
      const hit = this.physics!.raycast(new THREE.Vector3(x, fromY, z), down, 2, ignore);
      return hit ? fromY - hit.distance : null;
    };
    this.scripts = new ScriptSystem({
      assets: this.assets,
      audio: this.audio,
      effects: this.effects,
      physics: this.physics,
      input: this.input,
      hud: this.hud,
      pick: (x, y) => this.pickEntity(x, y),
      camera: () => this.activeCamera,
      weapons: { fire: (e) => this.weapons?.trigger(e), reload: (e) => this.weapons?.reload(e) },
      animate: (e, what) => this.models.playOnce(e, what) || this.sprites.playOnce(e, what),
      keyframes: (e, command) => this.keyframes.control(e, command),
      game: {
        pause: (on) => this.setGamePaused(on),
        restart: () => (this.restartRequested = this.playing),
        paused: () => this._gamePaused,
      },
      saves: browserSaves(() => this.gameId),
      sprites: { setFacing: (id, left) => this.sprites.setFacing(id, left), facingLeft: (id) => this.sprites.facingLeft(id) },
    });
    this.world.addSystem(this.scripts);
    this.cameras = new CameraSystem({
      input: this.input,
      physics: this.physics,
      pointerLocked: () => document.pointerLockElement === this.renderer.domElement,
      viewport: () => ({ width: this.renderer.domElement.clientWidth, height: this.renderer.domElement.clientHeight }),
      nodeOf: (e) => this.render.nodeOf(e),
    });
    this.world.addSystem(this.cameras);
    this.weapons = new WeaponSystem({
      physics: this.physics,
      scripts: () => this.scripts,
      input: this.input,
      render: this.render,
      scene: this.scene,
      camera: () => this.activeCamera,
      assets: this.assets,
      kick: (d) => this.cameras.kick(d),
      sound: (id, at) => void this.audio.playClip(id, at, 1),
    });
    this.physics.flat = this._settings.dimension === '2d';
    this.audio.grounded = (e) => this.physics?.isGrounded(e) ?? true;
    this.audio.surfaceSound = (e) => {
      const ground = this.physics?.groundOf(e);
      if (!ground) return undefined;
      for (let g: Entity | null = ground; g; g = g.parent) {
        const surface = g.get(Surface);
        if (surface?.footsteps) return { clip: surface.footsteps, volume: surface.volume };
      }
      const terrain = ground.get(Terrain);
      if (terrain) {
        const p = new THREE.Vector3().setFromMatrixPosition(this.render.nodeOf(e)?.matrixWorld ?? new THREE.Matrix4());
        const layer = this.terrain.layerAt(ground, p.x, p.z);
        const clip = layer >= 0 ? (terrain[`layer${layer + 1}Steps` as keyof typeof terrain] as string) : '';
        if (clip) return { clip, volume: 1 };
      }
      return null;
    };
    this.world.addSystem(this.weapons);
    // Third-person games capture the mouse when the player clicks into the game.
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);
    return this;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get settings(): SceneSettings {
    return this._settings;
  }

  set settings(value: SceneSettings) {
    this._settings = value;
    if (this.physics) this.physics.flat = value.dimension === '2d';
    this.renderer.toneMappingExposure = value.exposure;
    this.render.applySettings(value);
  }

  /** Replaces the world with a scene. Accepts parsed JSON (validated here). */
  loadScene(json: unknown): void {
    const data = parseScene(json);
    this.sceneName = data.name;
    this.settings = loadSceneInto(this.world, data);
  }

  saveScene(): SceneData {
    return serializeWorld(this.world, this.sceneName, this._settings);
  }

  /** The camera the next frame renders through. */
  get activeCamera(): THREE.PerspectiveCamera {
    return (this.useSceneCamera && this.render.sceneCamera()) || this.camera;
  }

  /** Called every rendered frame. Returns an unsubscribe function. */
  onUpdate(cb: FrameCallback): () => void {
    this.updateCallbacks.add(cb);
    return () => this.updateCallbacks.delete(cb);
  }

  /** Called once per fixed physics step, before the physics world steps. */
  onFixedUpdate(cb: FrameCallback): () => void {
    this.fixedCallbacks.add(cb);
    return () => this.fixedCallbacks.delete(cb);
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    if (this.cameras) this.world.removeSystem(this.cameras);
    if (this.scripts) this.world.removeSystem(this.scripts);
    this.hud.dispose();
    this.postfx.dispose();
    this.world.removeSystem(this.environment);
    this.world.removeSystem(this.ui);
    this.ui.dispose();
    if (this.physics) {
      this.world.removeSystem(this.physics);
      this.physics.dispose();
    }
    this.world.removeSystem(this.models);
    this.world.removeSystem(this.render);
    this.assets.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    if (this.maxFps > 0 && now - this.lastTime < 1000 / this.maxFps - 2) {
      this.rafId = requestAnimationFrame(this.frame);
      return;
    }
    const elapsed = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Frames per second, smoothed (shown in the editor).
    const frameMs = Math.max(1, elapsed * 1000);
    this.fpsSmoothed += (1000 / frameMs - this.fpsSmoothed) * 0.05;
    this.input.beginFrame();
    if (this.restartRequested) {
      this.restartRequested = false;
      this.safely(() => this.restart());
    }

    let steps: number;
    let delta: number;
    if (this._gamePaused && this.playing && !this._paused) {
      // A menu is up: the world holds still; scripts only listen for keys, buttons still click.
      steps = 0;
      delta = 0;
      this.safely(() => this.scripts?.pausedUpdate());
    } else if (this._paused && this.playing) {
      // Frozen: no game time passes, except one frame per Step request.
      steps = this.stepRequested ? 1 : 0;
      delta = this.stepRequested ? this.time.fixedDelta : 0;
      this.stepRequested = false;
    } else {
      steps = this.time.tick(elapsed);
      delta = this.time.delta;
    }

    for (let i = 0; i < steps; i++) {
      this.safely(() => this.world.fixedUpdate(this.time.fixedDelta));
      this.runCallbacks(this.fixedCallbacks);
    }
    const tUpdate = performance.now();
    this.runCallbacks(this.updateCallbacks);
    this.safely(() => this.world.update(delta));
    shaderTime.value += delta; // water, lava… (freezes with the game when paused)

    const cam = this.activeCamera;
    this.fitCamera(cam);
    this.renderer.info.reset();
    const tRender = performance.now();
    // The look (outlines, colours, retro pixels) always shows; low quality skips glow and smoothing.
    const post = this.environment.postProcessing();
    if (post) {
      this.safely(() => this.postfx.render(this.scene, cam, post, !QUALITY[this._quality].post));
    } else {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.render(this.scene, cam);
    }
    if (this.world.profiling) {
      const k = 0.1;
      const p = this.profileTimes;
      p.update += (tRender - tUpdate - p.update) * k;
      p.render += (performance.now() - tRender - p.render) * k;
      p.frame += (frameMs - p.frame) * k;
    }
    this.input.endFrame();
    this.rafId = requestAnimationFrame(this.frame);
  };

  /** A broken game script must not kill the loop: log it and keep rendering. */
  private runCallbacks(callbacks: Set<FrameCallback>): void {
    for (const cb of callbacks) this.safely(() => cb(this));
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error('[EGE] frame step failed:', err);
    }
  }

  private fitCamera(cam: THREE.PerspectiveCamera): void {
    const size = this.renderer.getSize(this.sizeScratch);
    const aspect = size.x / size.y;
    if (cam.aspect !== aspect) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    if (this._settings.pixelPerfect && this.playing && isFlat(cam) && cam.parent?.userData.entityId) this.pixelPerfect(cam, size.y);
  }

  /**
   * Pixel-perfect 2D: the view shows a whole number of screen pixels per picture pixel (the
   * zoom nearest to the camera's view height), and the camera moves in whole screen pixels.
   */
  private pixelPerfect(cam: THREE.PerspectiveCamera, cssHeight: number): void {
    const ppu = Math.max(1, this._settings.pixelsPerUnit ?? 16);
    const screen = cssHeight * this.renderer.getPixelRatio();
    const wanted = (cam.userData.viewHeight as number | undefined) ?? (cam.userData.flatHeight as number);
    const zoom = Math.max(1, Math.round(screen / (ppu * wanted)));
    const height = screen / (ppu * zoom);
    if (Math.abs(height - (cam.userData.flatHeight as number)) > 1e-6) setFlat(cam, height);
    // Move in whole screen pixels: nudge the camera from where its object put it.
    const step = 1 / (ppu * zoom);
    const base = (cam.userData.pixelBase as THREE.Vector3 | undefined) ?? cam.position.clone();
    cam.userData.pixelBase = base;
    cam.position.copy(base);
    cam.updateMatrixWorld();
    const world = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    cam.position.x += Math.round(world.x / step) * step - world.x;
    cam.position.y += Math.round(world.y / step) * step - world.y;
    cam.updateMatrixWorld();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.fitCamera(this.camera);
  }
}
