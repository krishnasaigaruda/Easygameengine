import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { setFlat } from '@ege/runtime';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { AudioSource, Camera, Light, MeshRenderer, ModelRenderer, Music, ParticleSystem, THREE, Transform, UI_TYPES, type Engine, type Entity, type Vec3 } from '@ege/runtime';
import type { GizmoTool } from '../state/editorStore';
import { Flashlight, Lightbulb, Music as MusicIcon, Sparkles, Sun, Video, Volume2, type IconNode } from 'lucide';

const RAD2DEG = 180 / Math.PI;
const CLICK_SLOP_PX = 5;
const SNAP = { translate: 0.5, rotateDeg: 15, scale: 0.1 };

export interface EditorViewportCallbacks {
  /** User clicked an entity (or empty space → null). `additive` = Ctrl/Cmd/Shift held. */
  onPick(entityId: string | null, additive: boolean): void;
  /** Gizmo drag finished: each entity with its Transform data from when the drag started. */
  onTransformEnd(edits: { entity: Entity; before: object }[]): void;
  /** Started moving around while looking through the game camera: the editor switched back. */
  onLeaveGameView?(): void;
}

const ACTIVE_COLOR = 0xe0b23a;
const OTHER_COLOR = 0x9a7b2c;

const SPRITE_ICONS: Record<string, IconNode> = { sun: Sun, lightbulb: Lightbulb, flashlight: Flashlight, video: Video, sparkles: Sparkles, music: MusicIcon, volume: Volume2 };

/** Lucide icon → standalone SVG markup (white strokes). */
function iconSvg(node: IconNode, size: number): string {
  const body = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs ?? {}).map(([k, v]) => `${k}="${String(v)}"`).join(' ')}/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Billboard marker so lights/cameras (which have no mesh) can be seen and clicked. */
function makeIconSprite(icon: string): THREE.Sprite {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(27, 29, 34, 0.85)';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(224, 178, 58, 0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, S * 0.22, S * 0.22, S * 0.56, S * 0.56);
    tex.needsUpdate = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(SPRITE_ICONS[icon] ?? Lightbulb, 64))}`;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }),
  );
  sprite.scale.setScalar(0.04);
  sprite.renderOrder = 999;
  sprite.userData.editorOnly = true;
  return sprite;
}

function iconFor(e: Entity): string | null {
  const l = e.get(Light);
  if (l) return l.kind === 'directional' ? 'sun' : l.kind === 'spot' ? 'flashlight' : 'lightbulb';
  if (e.has(Camera)) return 'video';
  if (e.has('Light2D')) return 'lightbulb';
  // Things you can't otherwise see or click get an icon to grab them by.
  const visible = e.has(MeshRenderer) || e.has(ModelRenderer);
  if (e.has(ParticleSystem)) return 'sparkles';
  if (e.has(Music)) return 'music';
  if (e.has(AudioSource) && !visible) return 'volume';
  return null;
}

/**
 * Editor-only interaction for the 3D view: orbit camera, picking, transform gizmo, grid,
 * selection outline and icons. Nothing here ships in exported games.
 */
export class EditorViewport {
  readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly gizmoHelper: THREE.Object3D;
  private readonly grid: THREE.GridHelper;
  /** One outline per selected object (the active one brighter). */
  private readonly selectionBoxes: THREE.BoxHelper[] = [];
  /** With several objects selected, the gizmo moves this and they follow. */
  private readonly pivot = new THREE.Object3D();
  private readonly icons = new Map<string, THREE.Sprite>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly engine: Engine;
  private readonly callbacks: EditorViewportCallbacks;
  private selected: Entity | null = null;
  /** Everything selected (active one included). */
  private group: Entity[] = [];
  private drag: { pivot: THREE.Matrix4; items: { entity: Entity; before: object; world: THREE.Matrix4 }[] } | null = null;
  private pointerDownAt: { x: number; y: number } | null = null;
  private iconsDirty = true;
  private disposers: (() => void)[] = [];
  private _gameView = false;
  private playing = false;
  private colliderLines: THREE.LineSegments | null = null;
  private editLightWanted = false;
  private tool: GizmoTool = 'translate';
  /** Dragging the selected object itself (Move tool): slides it over the ground. */
  private surfaceDrag: {
    plane: THREE.Plane;
    start: THREE.Vector3;
    /** What the dragged objects can slide over (everything else in the scene, minus plants/grass). */
    surfaces: THREE.Object3D[];
    /** The active object's height above the surface it stood on, and its offset from the cursor. */
    lift: number;
    offset: THREE.Vector3;
    anchor: THREE.Vector3;
    /** Where the press started (a click shouldn't nudge anything) and whether it has moved yet. */
    downAt: { x: number; y: number };
    moved: boolean;
    items: { entity: Entity; before: object; world: THREE.Matrix4 }[];
  } | null = null;
  private editLights: THREE.Light[] | null = null;
  /** A terrain brush is active: left drag paints instead of orbiting/picking. */
  brushing = false;
  /** Right mouse held: Unity-style fly camera (mouse looks, WASD / QE moves). */
  private fly: { yaw: number; pitch: number; dx: number; dy: number; keys: Set<string>; speed: number; last: number } | null = null;

  constructor(engine: Engine, callbacks: EditorViewportCallbacks) {
    this.engine = engine;
    this.callbacks = callbacks;
    const dom = engine.renderer.domElement;

    this.orbit = new OrbitControls(engine.camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.target.set(0, 1, -4);
    // Middle drag pans, Alt + left drag orbits; the right button is the fly camera (below).
    this.applyMouseButtons();
    this.orbit.update();
    const alt = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || this.altHeld === (e.type === 'keydown')) return;
      this.altHeld = e.type === 'keydown';
      this.applyMouseButtons();
    };
    const altOff = () => {
      this.altHeld = false;
      this.applyMouseButtons();
    };
    window.addEventListener('keydown', alt);
    window.addEventListener('keyup', alt);
    window.addEventListener('blur', altOff);
    this.disposers.push(() => {
      window.removeEventListener('keydown', alt);
      window.removeEventListener('keyup', alt);
      window.removeEventListener('blur', altOff);
    });

    this.grid = new THREE.GridHelper(100, 100, 0x000000, 0x000000);
    const gm = this.grid.material as THREE.Material;
    gm.opacity = 0.12;
    gm.transparent = true;
    gm.depthWrite = false;
    this.grid.position.y = 0.002;
    this.grid.renderOrder = -10; // drawn first, so water and glass cover it
    this.grid.userData.editorOnly = true;
    engine.scene.add(this.grid);

    this.pivot.name = 'EGE:Pivot';
    this.pivot.userData.editorOnly = true;
    engine.scene.add(this.pivot);

    this.gizmo = new TransformControls(engine.camera, dom);
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.userData.editorOnly = true;
    engine.scene.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
    });
    this.gizmo.addEventListener('mouseDown', () => {
      const list = this.group.length > 1 ? this.movable() : this.selected ? [this.selected] : [];
      if (!list.length) return;
      this.pivot.updateWorldMatrix(true, false);
      this.drag = {
        pivot: this.pivot.matrixWorld.clone(),
        items: list.map((entity) => {
          const node = this.engine.render.nodeOf(entity);
          node?.updateWorldMatrix(true, false);
          return { entity, before: structuredClone(entity.require(Transform)), world: node?.matrixWorld.clone() ?? new THREE.Matrix4() };
        }),
      };
    });
    this.gizmo.addEventListener('objectChange', () => {
      if (this.group.length > 1) this.writePivotToGroup();
      else this.writeNodeToTransform();
    });
    this.gizmo.addEventListener('mouseUp', () => {
      if (this.drag) this.callbacks.onTransformEnd(this.drag.items.map(({ entity, before }) => ({ entity, before })));
      this.drag = null;
    });

    const onDown = (e: PointerEvent) => {
      this.pointerDownAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      // Move tool: press on any object (or its icon) and drag to slide it over the ground and
      // other objects. Pressing the ground, grass or painted plants still moves the camera.
      if (e.button !== 0 || this.tool !== 'translate' || this._gameView || this.playing || this.brushing || this.gizmo.dragging) return;
      if ((this.gizmo as unknown as { axis: string | null }).axis) return; // over a gizmo handle
      const hit = this.pickAt(e.clientX, e.clientY);
      const pressed = hit.entityId ? this.engine.world.getById(hit.entityId) : undefined;
      if (!pressed || !isDraggable(pressed)) return;
      let group = this.group.length ? this.group : this.selected ? [this.selected] : [];
      // Big scenery (the ground, a floor) is only dragged once it's selected: a drag across it
      // otherwise slides the whole level by accident.
      const node0 = this.engine.render.nodeOf(pressed);
      if (!group.some((g) => g.id === pressed.id) && node0 && isScenery(node0)) return;
      if (!group.some((g) => g.id === pressed.id)) {
        // Not selected yet: select it and drag it in one go.
        this.callbacks.onPick(pressed.id, false);
        group = [pressed];
      }
      const ray = this.raycaster.ray.clone();
      const node = this.engine.render.nodeOf(pressed);
      if (!node) return;
      node.updateWorldMatrix(true, false);
      const pos = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
      // 3D: slide along the ground; 2D: on the flat plane, facing the camera.
      const plane = this.flat ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -pos.z) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -pos.y);
      const start = ray.intersectPlane(plane, new THREE.Vector3());
      if (!start) return;
      const items = group.length > 1 && this.group.length > 1 ? this.movable() : group;
      const surfaces = this.flat ? [] : this.surfacesExcept(items.map((g) => this.engine.render.nodeOf(g)).filter((n): n is THREE.Object3D => !!n));
      // How high it stands above what's under it, so it keeps standing on things as it slides.
      const down = new THREE.Raycaster(pos.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, -1, 0));
      const below = down.intersectObjects(surfaces, false)[0];
      const lift = below ? pos.y - below.point.y : 0;
      const under = this.raycaster.intersectObjects(surfaces, false)[0]?.point ?? start;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.orbit.enabled = false;
      this.surfaceDrag = {
        plane,
        start,
        surfaces,
        lift,
        offset: this.flat ? new THREE.Vector3(pos.x - start.x, pos.y - start.y, 0) : new THREE.Vector3(pos.x - under.x, 0, pos.z - under.z),
        anchor: pos,
        downAt: { x: e.clientX, y: e.clientY },
        moved: false,
        items: items.map((entity) => this.dragItem(entity)),
      };
    };
    const onDragMove = (e: PointerEvent) => {
      const d = this.surfaceDrag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.downAt.x, e.clientY - d.downAt.y) <= CLICK_SLOP_PX) return;
      d.moved = true;
      const rect = dom.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.engine.camera);
      // On whatever is under the cursor (terrain, a table, a roof); otherwise level.
      const hit = this.raycaster.intersectObjects(d.surfaces, false)[0];
      let target: THREE.Vector3;
      if (hit) target = hit.point.clone().add(d.offset).setY(hit.point.y + d.lift);
      else {
        const p = this.raycaster.ray.intersectPlane(d.plane, new THREE.Vector3());
        if (!p) return;
        target = this.flat ? p.add(d.offset).setZ(d.anchor.z) : p.add(d.offset).setY(d.anchor.y);
      }
      const delta = target.sub(d.anchor);
      if (this.snapOn) {
        delta.x = Math.round(delta.x / SNAP.translate) * SNAP.translate;
        if (this.flat) delta.y = Math.round(delta.y / SNAP.translate) * SNAP.translate;
        else delta.z = Math.round(delta.z / SNAP.translate) * SNAP.translate;
      }
      const move = new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z);
      for (const { entity, world } of d.items) this.writeWorld(entity, move.clone().multiply(world));
    };
    const onDragUp = () => {
      const d = this.surfaceDrag;
      if (!d) return;
      this.surfaceDrag = null;
      this.orbit.enabled = !this._gameView && !this.brushing;
      if (!d.moved) return; // just a click: it was selected, nothing moved
      this.pointerDownAt = null; // not a click
      this.callbacks.onTransformEnd(d.items.map(({ entity, before }) => ({ entity, before })));
    };
    // Looking through the game camera and starting to move: switch back to the editor camera
    // right where the game camera is, instead of silently ignoring the mouse.
    const leaveGame = (e: Event) => {
      if (!this._gameView || this.playing) return;
      if (e instanceof PointerEvent && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
      this.leaveGameView();
    };
    dom.addEventListener('pointerdown', leaveGame, true);
    dom.addEventListener('wheel', leaveGame, { capture: true, passive: true });
    this.disposers.push(() => {
      dom.removeEventListener('pointerdown', leaveGame, true);
      dom.removeEventListener('wheel', leaveGame, { capture: true });
    });
    dom.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
    this.disposers.push(() => {
      dom.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragUp);
    });
    const onUp = (e: PointerEvent) => {
      const start = this.pointerDownAt;
      this.pointerDownAt = null;
      if (!start || e.button !== 0 || this._gameView) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP_PX) return; // orbit drag
      if (this.gizmo.dragging || this.drag || this.brushing || this.tool === 'view') return;
      this.callbacks.onPick(this.pick(e.clientX, e.clientY), e.metaKey || e.ctrlKey || e.shiftKey);
    };
    dom.addEventListener('pointerup', onUp);
    this.disposers.push(() => dom.removeEventListener('pointerup', onUp));

    // ── fly camera ──
    const flyDown = (e: PointerEvent) => {
      if (e.button !== 2 || this._gameView || this.flat) return;
      e.preventDefault();
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        // not a real pointer (synthetic event): fine without capture
      }
      const cam = this.engine.camera;
      const euler = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
      this.fly = { yaw: euler.y, pitch: euler.x, dx: 0, dy: 0, keys: new Set(), speed: this.fly?.speed ?? 6, last: performance.now() };
      this.orbit.enabled = false;
    };
    const flyMove = (e: PointerEvent) => {
      if (!this.fly) return;
      this.fly.dx += e.movementX;
      this.fly.dy += e.movementY;
    };
    const flyUp = (e: PointerEvent) => {
      if (e.button !== 2 || !this.fly) return;
      try {
        if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      } catch {
        // see flyDown
      }
      // Keep orbiting around a point in front of where we ended up.
      const cam = this.engine.camera;
      const dist = Math.max(2, cam.position.distanceTo(this.orbit.target));
      this.orbit.target.copy(cam.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(dist));
      this.fly = null;
      this.orbit.enabled = !this._gameView;
    };
    const flyKey = (e: KeyboardEvent, down: boolean) => {
      if (!this.fly) return;
      const k = e.code;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(k)) {
        e.preventDefault();
        e.stopPropagation(); // W/E/R tool shortcuts don't fire while flying
        if (down) this.fly.keys.add(k);
        else this.fly.keys.delete(k);
      }
    };
    const keyDown = (e: KeyboardEvent) => flyKey(e, true);
    const keyUp = (e: KeyboardEvent) => flyKey(e, false);
    const flyWheel = (e: WheelEvent) => {
      if (!this.fly) return;
      // Scrolling while flying changes the speed instead of zooming.
      e.preventDefault();
      e.stopImmediatePropagation();
      this.fly.speed = THREE.MathUtils.clamp(this.fly.speed * (e.deltaY < 0 ? 1.25 : 0.8), 0.5, 200);
    };
    const noMenu = (e: Event) => e.preventDefault();
    dom.addEventListener('pointerdown', flyDown);
    dom.addEventListener('pointermove', flyMove);
    dom.addEventListener('pointerup', flyUp);
    dom.addEventListener('wheel', flyWheel, { capture: true, passive: false });
    dom.addEventListener('contextmenu', noMenu);
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp, true);
    this.disposers.push(() => {
      dom.removeEventListener('pointerdown', flyDown);
      dom.removeEventListener('pointermove', flyMove);
      dom.removeEventListener('pointerup', flyUp);
      dom.removeEventListener('wheel', flyWheel, { capture: true });
      dom.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
    });

    const markIcons = () => {
      this.iconsDirty = true;
    };
    const ev = engine.world.events;
    this.disposers.push(
      ev.on('entityCreated', markIcons),
      ev.on('entityDestroyed', markIcons),
      ev.on('componentAdded', markIcons),
      ev.on('componentRemoved', markIcons),
      ev.on('componentChanged', ({ type }) => (type === Light.type || type === 'Light2D') && markIcons()),
      // Undo of a delete re-creates the node; re-attach the gizmo to the fresh one.
      ev.on('entityCreated', ({ entity }) => {
        if (this.selected?.id === entity.id) this.setSelection(entity);
      }),
    );
    this.disposers.push(engine.onUpdate(() => this.tick()));
  }

  get gameView(): boolean {
    return this._gameView;
  }

  /** Looking through the scene camera: hide all editor helpers and disable editing. */
  set gameView(on: boolean) {
    this._gameView = on;
    this.engine.useSceneCamera = on;
    this.orbit.enabled = !on;
    this.grid.visible = !on;
    for (const s of this.icons.values()) s.visible = !on;
    this.refreshGizmo();
    this.applyEditLight();
  }

  /** Back to the editor camera, placed where the game camera was looking from. */
  leaveGameView(): void {
    const scene = this.engine.activeCamera;
    scene.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    scene.matrixWorld.decompose(pos, quat, new THREE.Vector3());
    const cam = this.engine.camera;
    this.gameView = false;
    cam.position.copy(pos);
    cam.quaternion.copy(quat);
    this.orbit.target.copy(pos).add(new THREE.Vector3(0, 0, -8).applyQuaternion(quat));
    this.orbit.update();
    this.callbacks.onLeaveGameView?.();
  }

  /** While playing, the gizmo is hidden (physics owns the objects). */
  setPlaying(on: boolean): void {
    this.playing = on;
    this.refreshGizmo();
    this.applyEditLight();
  }

  /** Editing a dark (or foggy) level: extra editor-only light and no fog in the editor view. */
  setEditLight(on: boolean): void {
    this.editLightWanted = on;
    this.applyEditLight();
  }

  private applyEditLight(): void {
    const on = this.editLightWanted && !this._gameView && !this.playing;
    if (on && !this.editLights) {
      const fill = new THREE.HemisphereLight(0xffffff, 0x888888, 3);
      const head = new THREE.DirectionalLight(0xffffff, 2.2);
      head.position.set(0, 0, 0);
      head.target.position.set(0, 0, -1);
      this.engine.camera.add(head, head.target); // a headlight: lights whatever you look at
      fill.userData.editorOnly = head.userData.editorOnly = true;
      this.engine.scene.add(fill);
      if (!this.engine.camera.parent) this.engine.scene.add(this.engine.camera);
      this.editLights = [fill, head];
    }
    for (const l of this.editLights ?? []) l.visible = on;
    this.engine.environment.hideFog = on;
  }

  /** Draw every physics collider as wireframe lines. */
  setShowColliders(on: boolean): void {
    if (on && !this.colliderLines) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 });
      this.colliderLines = new THREE.LineSegments(geo, mat);
      this.colliderLines.userData.editorOnly = true;
      this.colliderLines.renderOrder = 997;
      this.colliderLines.frustumCulled = false;
      this.engine.scene.add(this.colliderLines);
    } else if (!on && this.colliderLines) {
      this.colliderLines.removeFromParent();
      this.colliderLines.geometry.dispose();
      (this.colliderLines.material as THREE.Material).dispose();
      this.colliderLines = null;
    }
  }

  /** `entity` is the active one (gets the gizmo); `all` is everything selected. */
  setSelection(entity: Entity | null, all: Entity[] = entity ? [entity] : []): void {
    // Called on every world revision; re-attaching mid-drag would interrupt the gizmo.
    if (this.drag) return;
    const sameGroup = all.length === this.group.length && all.every((e, i) => e === this.group[i]);
    const node = entity && this.engine.render.nodeOf(entity);
    this.group = all;
    if (entity === this.selected && sameGroup && (all.length > 1 || (node ?? undefined) === this.gizmo.object)) {
      if (all.length > 1) this.placePivot();
      return;
    }
    this.selected = entity;
    this.refreshGizmo();
  }

  /** Selected objects whose parent isn't also selected (moving a parent already moves its children). */
  private movable(): Entity[] {
    const set = new Set(this.group);
    return this.group.filter((e) => {
      for (let p = e.parent; p; p = p.parent) if (set.has(p)) return false;
      return true;
    });
  }

  /** The multi-selection pivot sits on the active object, aligned with the world. */
  private placePivot(): void {
    const node = this.selected && this.engine.render.nodeOf(this.selected);
    if (!node) return;
    node.updateWorldMatrix(true, false);
    this.pivot.position.setFromMatrixPosition(node.matrixWorld);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
  }

  setTool(tool: GizmoTool): void {
    this.tool = tool;
    if (tool !== 'view') this.gizmo.setMode(tool);
    this.applyMouseButtons();
    this.refreshGizmo();
  }

  /**
   * The left button only moves the view with the Hand tool (pan), or with Alt held (orbit, in 3D):
   * with Move / Rotate / Scale it is for objects. The middle button pans; the right one looks
   * around (3D) or pans (2D).
   */
  private altHeld = false;
  private applyMouseButtons(): void {
    const left = this.tool === 'view' ? THREE.MOUSE.PAN : this.altHeld && !this.flat ? THREE.MOUSE.ROTATE : null;
    this.orbit.mouseButtons = { LEFT: left as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: (this.flat ? THREE.MOUSE.PAN : null) as unknown as THREE.MOUSE };
  }

  /** 2D projects: look straight at the flat plane (z = 0); drag pans, the wheel zooms, no turning. */
  private flat = false;
  setFlat(on: boolean): void {
    if (on === this.flat) return;
    this.flat = on;
    const cam = this.engine.camera;
    const t = this.orbit.target;
    if (on) {
      t.set(0, 2, 0); // a project's saved view (if any) comes back right after
      cam.position.set(t.x, t.y, 40);
      cam.up.set(0, 1, 0);
      cam.lookAt(t);
      cam.zoom = 1;
      setFlat(cam, 14);
    } else {
      setFlat(cam, null);
      cam.zoom = 1;
      cam.position.set(t.x + 8, t.y + 6, t.z + 10);
      cam.lookAt(t);
    }
    cam.updateProjectionMatrix();
    this.orbit.enableRotate = !on;
    this.orbit.screenSpacePanning = true;
    this.grid.rotation.x = on ? Math.PI / 2 : 0;
    this.grid.position.set(0, on ? 0 : 0.002, on ? -0.05 : 0);
    this.setTool(this.tool);
    this.orbit.update();
  }

  private snapOn = false;

  private dragItem(entity: Entity): { entity: Entity; before: object; world: THREE.Matrix4 } {
    const node = this.engine.render.nodeOf(entity);
    node?.updateWorldMatrix(true, false);
    return { entity, before: structuredClone(entity.require(Transform)), world: node?.matrixWorld.clone() ?? new THREE.Matrix4() };
  }

  /** Put an entity at a world matrix (writes its local Transform). */
  private writeWorld(entity: Entity, world: THREE.Matrix4): void {
    const node = this.engine.render.nodeOf(entity);
    if (!node) return;
    const parentWorld = node.parent ? node.parent.matrixWorld.clone() : new THREE.Matrix4();
    const local = parentWorld.invert().multiply(world);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    local.decompose(pos, quat, scl);
    const eul = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    const round = (v: number, p = 1000) => Math.round(v * p) / p;
    entity.set(Transform, {
      position: pos.toArray().map((v) => round(v)) as Vec3,
      rotation: [eul.x, eul.y, eul.z].map((v) => round(v * RAD2DEG, 100)) as Vec3,
      scale: scl.toArray().map((v) => round(v)) as Vec3,
    });
  }

  setSnap(on: boolean): void {
    this.snapOn = on;
    this.gizmo.setTranslationSnap(on ? SNAP.translate : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(SNAP.rotateDeg) : null);
    this.gizmo.setScaleSnap(on ? SNAP.scale : null);
  }

  /** Where new objects appear: the point the camera orbits around, on the ground grid. */
  /** The editor camera's view (to remember it per project). */
  getView(): { position: Vec3; target: Vec3 } {
    const r = (v: number) => Math.round(v * 100) / 100;
    const p = this.engine.camera.position;
    const t = this.orbit.target;
    return { position: [r(p.x), r(p.y), r(p.z)], target: [r(t.x), r(t.y), r(t.z)] };
  }

  setView(view: { position: Vec3; target: Vec3 }): void {
    this.engine.camera.position.set(...view.position);
    this.orbit.target.set(...view.target);
    this.engine.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  /** Where new objects appear: on whatever is in the middle of the view (terrain, a floor), else on the ground grid. */
  spawnPoint(): Vec3 {
    const r = (v: number) => Math.round(v * 2) / 2;
    // 2D: the middle of the view, on the flat plane.
    if (this.flat) return [r(this.orbit.target.x), r(this.orbit.target.y), 0];
    const surfaces = this.surfacesExcept([]);
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.engine.camera);
    const ahead = this.raycaster.intersectObjects(surfaces, false)[0];
    if (ahead && ahead.distance < 400) return [r(ahead.point.x), Math.round(ahead.point.y * 100) / 100, r(ahead.point.z)];
    // Looking at the sky: below the point the camera orbits around.
    const t = this.orbit.target;
    const down = new THREE.Raycaster(new THREE.Vector3(t.x, 10000, t.z), new THREE.Vector3(0, -1, 0));
    const below = down.intersectObjects(surfaces, false)[0];
    return [r(t.x), below ? Math.round(below.point.y * 100) / 100 : 0, r(t.z)];
  }

  /** Frame the selected entity (F key). */
  focusSelected(): void {
    const node = this.selected && this.engine.render.nodeOf(this.selected);
    if (!node) return;
    // Frame everything selected.
    const box = new THREE.Box3();
    for (const e of this.group.length ? this.group : [this.selected!]) {
      const n = this.engine.render.nodeOf(e);
      if (n) box.union(new THREE.Box3().setFromObject(n));
    }
    const center = box.isEmpty() ? node.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 1 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
    const cam = this.engine.camera;
    const dir = cam.position.clone().sub(this.orbit.target).normalize();
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.2;
    this.orbit.target.copy(center);
    cam.position.copy(center).addScaledVector(dir, distance);
    this.orbit.update();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.gizmoHelper.removeFromParent();
    this.grid.removeFromParent();
    this.grid.geometry.dispose();
    for (const box of this.selectionBoxes) {
      box.removeFromParent();
      box.geometry.dispose();
      (box.material as THREE.Material).dispose();
    }
    this.pivot.removeFromParent();
    this.setShowColliders(false);
    for (const s of this.icons.values()) {
      s.removeFromParent();
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.icons.clear();
  }

  private refreshGizmo(): void {
    // 2D: only the flat plane's axes (move in X/Y, turn around Z).
    this.gizmo.showZ = !this.flat || this.tool === 'rotate';
    this.gizmo.showX = !this.flat || this.tool !== 'rotate';
    this.gizmo.showY = !this.flat || this.tool !== 'rotate';
    const node = this.selected && this.engine.render.nodeOf(this.selected);
    // UI lives on the screen (drag it there), not in the 3D world.
    const screenOnly = !!this.selected && UI_TYPES.some((t) => this.selected!.has(t));
    if (!node || this._gameView || this.playing || screenOnly || this.tool === 'view') this.gizmo.detach();
    else if (this.group.length > 1) {
      this.placePivot();
      this.gizmo.attach(this.pivot);
    } else this.gizmo.attach(node);
  }

  /** True while the right mouse button flies the camera. */
  get flying(): boolean {
    return !!this.fly;
  }

  private tickFly(): void {
    const f = this.fly!;
    const now = performance.now();
    const dt = Math.min(0.1, (now - f.last) / 1000);
    f.last = now;
    const cam = this.engine.camera;
    f.yaw -= f.dx * 0.0035;
    f.pitch = THREE.MathUtils.clamp(f.pitch - f.dy * 0.0035, -1.55, 1.55);
    f.dx = f.dy = 0;
    cam.quaternion.setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
    const k = f.keys;
    const move = new THREE.Vector3((k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0), (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0));
    if (move.lengthSq() > 0) {
      const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
      const local = new THREE.Vector3(move.x, 0, move.z).applyQuaternion(cam.quaternion);
      local.y += move.y;
      cam.position.addScaledVector(local.normalize(), f.speed * fast * dt);
    }
  }

  private tick(): void {
    if (this.fly) this.tickFly();
    else this.orbit.update();
    // While a terrain brush is active the left button paints; orbit with the right button (fly) instead.
    if (!this.fly) this.orbit.enabled = !this._gameView && !this.brushing;
    if (this.brushing && this.gizmo.object) this.gizmo.detach();
    else if (!this.brushing && !this.gizmo.object && this.selected && !this._gameView && !this.playing) this.refreshGizmo();
    if (this.colliderLines && this.engine.physics) {
      const { vertices, colors } = this.engine.physics.debugLines();
      const g = this.colliderLines.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      // Rapier gives RGBA; tint everything a readable green, triggers stay their own color.
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      g.computeBoundingSphere();
    }
    if (this.iconsDirty) this.syncIcons();
    this.syncSelectionBoxes();
  }

  private syncSelectionBoxes(): void {
    const list = this._gameView ? [] : this.group;
    while (this.selectionBoxes.length < list.length) {
      const box = new THREE.BoxHelper(new THREE.Object3D(), ACTIVE_COLOR);
      box.userData.editorOnly = true;
      (box.material as THREE.LineBasicMaterial).depthTest = false;
      box.renderOrder = 998;
      this.engine.scene.add(box);
      this.selectionBoxes.push(box);
    }
    this.selectionBoxes.forEach((box, i) => {
      const e = list[i];
      const node = e && this.engine.render.nodeOf(e);
      box.visible = !!node;
      if (!node) return;
      box.setFromObject(node);
      (box.material as THREE.LineBasicMaterial).color.setHex(e === this.selected ? ACTIVE_COLOR : OTHER_COLOR);
    });
  }

  private syncIcons(): void {
    this.iconsDirty = false;
    const seen = new Set<string>();
    for (const e of this.engine.world.all()) {
      const iconName = iconFor(e);
      const node = this.engine.render.nodeOf(e);
      if (!iconName || !node) continue;
      seen.add(e.id);
      let sprite = this.icons.get(e.id);
      if (sprite && (sprite.userData.icon !== iconName || sprite.parent !== node)) {
        sprite.removeFromParent();
        sprite.material.map?.dispose();
        sprite.material.dispose();
        sprite = undefined;
      }
      if (!sprite) {
        sprite = makeIconSprite(iconName);
        sprite.userData.icon = iconName;
        sprite.userData.iconFor = e.id;
        sprite.visible = !this._gameView;
        node.add(sprite);
        this.icons.set(e.id, sprite);
      }
    }
    for (const [id, sprite] of this.icons) {
      if (seen.has(id)) continue;
      sprite.removeFromParent();
      sprite.material.map?.dispose();
      sprite.material.dispose();
      this.icons.delete(id);
    }
  }

  /** Meshes things can be dragged onto: the scene minus the dragged objects, plants, grass and helpers. */
  private surfacesExcept(dragged: THREE.Object3D[]): THREE.Object3D[] {
    const skip = new Set(dragged);
    const out: THREE.Object3D[] = [];
    const visit = (o: THREE.Object3D) => {
      if (skip.has(o) || !o.visible || o.userData.editorOnly || o.userData.iconFor) return;
      // Thousands of painted copies: too slow to test, and you don't put a house on a fern.
      if (o.name === 'EGE:Scatter' || o.name === 'EGE:Grass') return;
      if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) out.push(o);
      for (const c of o.children) visit(c);
    };
    visit(this.engine.render.root);
    return out;
  }

  private pick(clientX: number, clientY: number): string | null {
    return this.pickAt(clientX, clientY).entityId;
  }

  /**
   * What's under a screen point: the entity hit (if any) and the 3D point — on that surface,
   * or on the ground plane (y = 0) when nothing is hit.
   */
  pickAt(clientX: number, clientY: number): { entityId: string | null; point: Vec3 } {
    const rect = this.engine.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const hits = this.raycaster.intersectObject(this.engine.render.root, true);
    for (const hit of hits) {
      if (!isVisible(hit.object)) continue;
      // Icons (lights, cameras, effects) select their object.
      if (hit.object.userData.iconFor) return { entityId: hit.object.userData.iconFor as string, point: roundVec(hit.point) };
      if (hit.object.userData.editorOnly) continue;
      const entity = this.engine.render.entityFromObject(hit.object);
      if (entity) return { entityId: entity.id, point: roundVec(hit.point) };
    }
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = this.raycaster.ray.intersectPlane(ground, new THREE.Vector3());
    return { entityId: null, point: p ? roundVec(p) : this.spawnPoint() };
  }

  /** Several objects selected: apply the pivot's movement to each of them (in world space). */
  private writePivotToGroup(): void {
    const d = this.drag;
    if (!d) return;
    this.pivot.updateWorldMatrix(true, false);
    const delta = this.pivot.matrixWorld.clone().multiply(d.pivot.clone().invert());
    const round = (v: number, p = 1000) => Math.round(v * p) / p;
    for (const { entity, world } of d.items) {
      const node = this.engine.render.nodeOf(entity);
      if (!node) continue;
      const parentWorld = node.parent ? node.parent.matrixWorld.clone() : new THREE.Matrix4();
      const local = parentWorld.invert().multiply(delta.clone().multiply(world));
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      local.decompose(pos, quat, scl);
      const eul = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
      entity.set(Transform, {
        position: pos.toArray().map((v) => round(v)) as Vec3,
        rotation: [eul.x, eul.y, eul.z].map((v) => round(v * RAD2DEG, 100)) as Vec3,
        scale: scl.toArray().map((v) => round(v)) as Vec3,
      });
    }
  }

  private writeNodeToTransform(): void {
    const e = this.selected;
    const node = e && this.engine.render.nodeOf(e);
    if (!e || !node) return;
    const round = (v: number, p = 1000) => Math.round(v * p) / p;
    e.set(Transform, {
      position: node.position.toArray().map((v) => round(v)) as Vec3,
      rotation: [node.rotation.x, node.rotation.y, node.rotation.z].map((v) => round(v * RAD2DEG, 100)) as Vec3,
      scale: node.scale.toArray().map((v) => round(v)) as Vec3,
    });
  }
}

function roundVec(v: THREE.Vector3): Vec3 {
  const r = (n: number) => Math.round(n * 100) / 100;
  return [r(v.x), r(v.y), r(v.z)];
}

function isVisible(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

/** Pressing these drags the camera, not them: the ground and what is painted on it. */
function isDraggable(e: Entity): boolean {
  return !e.has('Terrain') && !e.has('Grass') && !e.has('Scatter');
}

/** Wider than this (m) counts as scenery (ground, floors, big walls). */
const SCENERY_SIZE = 15;
function isScenery(node: THREE.Object3D): boolean {
  const size = new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3());
  return Math.max(size.x, size.z) > SCENERY_SIZE;
}

