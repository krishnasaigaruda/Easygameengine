import { Grass, Scatter, THREE, Terrain, encodePaint as encode, paintDab, type Engine, type Entity } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { useTerrainBrush } from '../editor/terrainBrush';
import { addComponent, commitLiveEdit } from '../editor/actions';
import type { EditorViewport } from './EditorViewport';

const COLORS: Record<string, number> = { lower: 0x5aa9ff, paint: 0x8fd16a, grass: 0x6fd14a, plants: 0xff8fd1, erase: 0xff5a4a };

/**
 * Terrain brushes in the viewport: a ring shows where the brush is; holding the left button
 * sculpts, paints the ground texture, or paints grass / plants (hold Shift to erase).
 * One stroke = one undo step.
 */
export function attachTerrainPainter(engine: Engine, viewport: EditorViewport): () => void {
  const dom = engine.renderer.domElement;
  const ray = new THREE.Raycaster();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe0b23a, transparent: true, opacity: 0.9, depthTest: false }),
  );
  ring.renderOrder = 999;
  ring.userData.editorOnly = true;
  ring.visible = false;
  engine.scene.add(ring);

  let pointer: { x: number; y: number } | null = null;
  let erase = false;
  /** The current stroke: what's being changed and its data before the stroke (for undo). */
  let stroke: { terrain: Entity; target: Entity; type: string; before: object; flattenTo?: number } | null = null;
  let raf = 0;

  const active = (): Entity | null => {
    const s = useEditor.getState();
    const b = useTerrainBrush.getState();
    if (!b.brush || s.playing || viewport.gameView || !s.selection) return null;
    const e = s.engine?.world.getById(s.selection);
    return e?.has(Terrain) ? e : null;
  };

  const hit = (e: Entity): THREE.Vector3 | null => {
    const mesh = engine.terrain.meshOf(e.id);
    if (!mesh || !pointer) return null;
    const r = dom.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((pointer.x - r.left) / r.width) * 2 - 1, -((pointer.y - r.top) / r.height) * 2 + 1), engine.camera);
    return ray.intersectObject(mesh, false)[0]?.point ?? null;
  };

  /** Grid coordinates of a world point on the terrain (for paint maps). */
  const grid = (e: Entity, p: THREE.Vector3) => {
    const mesh = engine.terrain.meshOf(e.id)!;
    const t = e.require(Terrain);
    mesh.updateWorldMatrix(true, false);
    const local = mesh.worldToLocal(p.clone());
    const g = Math.round(t.resolution) / t.size;
    return { gx: (local.x + t.size / 2) * g, gz: (local.z + t.size / 2) * g, perMeter: g };
  };

  /** Brushes work by time, not frames: the same stroke does the same at 30 or 144 FPS. */
  let last = performance.now();
  let frame = 1;
  const dab = (terrain: Entity, p: THREE.Vector3) => {
    const b = useTerrainBrush.getState();
    if (!stroke || !b.brush) return;
    const k = Math.min(1, b.strength * frame);
    if (b.brush === 'grass' || b.brush === 'plants') {
      const live = b.brush === 'grass' ? engine.grass.paintData(terrain.id) : engine.scatter.paintData(stroke.target);
      if (!live) return;
      const { gx, gz, perMeter } = grid(terrain, p);
      paintDab(live.map, live.resolution, gx, gz, b.size * perMeter, k * 0.25, erase);
      live.changed();
      return;
    }
    engine.terrain.sculpt(terrain, p, { brush: b.brush, radius: b.size, strength: k * (b.brush === 'paint' ? 0.25 : 0.5), layer: b.layer, target: stroke.flattenTo, breakup: b.breakup, breakupScale: b.patchSize });
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    frame = Math.min(4, (now - last) / (1000 / 60)); // 1 at 60 FPS
    last = now;
    const e = active();
    viewport.brushing = !!e;
    const b = useTerrainBrush.getState();
    const p = e ? hit(e) : null;
    ring.visible = !!p;
    if (!e || !p) return;
    ring.position.copy(p).add(new THREE.Vector3(0, 0.05, 0));
    ring.scale.setScalar(b.size);
    (ring.material as THREE.MeshBasicMaterial).color.setHex(erase && (b.brush === 'grass' || b.brush === 'plants') ? COLORS.erase : COLORS[b.brush!] ?? 0xe0b23a);
    if (stroke?.terrain === e) dab(e, p);
  };
  raf = requestAnimationFrame(tick);

  const onMove = (ev: PointerEvent) => {
    pointer = { x: ev.clientX, y: ev.clientY };
    erase = ev.shiftKey;
  };
  const onDown = (ev: PointerEvent) => {
    pointer = { x: ev.clientX, y: ev.clientY };
    erase = ev.shiftKey;
    const terrain = active();
    if (!terrain || ev.button !== 0) return;
    const p = hit(terrain);
    if (!p) return;
    ev.preventDefault();
    ev.stopImmediatePropagation(); // no orbiting or picking while painting
    const b = useTerrainBrush.getState();
    if (b.brush === 'grass') {
      if (!terrain.has(Grass)) addComponent(terrain, Grass.type); // painting grass gives the terrain grass
      stroke = { terrain, target: terrain, type: Grass.type, before: structuredClone(terrain.require(Grass)) };
    } else if (b.brush === 'plants') {
      const plant = b.plant ? engine.world.getById(b.plant) : undefined;
      if (!plant?.has(Scatter)) {
        useEditor.getState().log('warn', 'Pick or add a plant type in the Terrain panel first.');
        return;
      }
      stroke = { terrain, target: plant, type: Scatter.type, before: structuredClone(plant.require(Scatter)) };
    } else {
      stroke = { terrain, target: terrain, type: Terrain.type, before: structuredClone(terrain.require(Terrain)), flattenTo: b.brush === 'flatten' ? engine.terrain.localHeightAt(terrain, p) : undefined };
    }
    frame = 1;
    dab(terrain, p);
  };
  const onUp = () => {
    if (!stroke) return;
    const { terrain, target, type, before } = stroke;
    stroke = null;
    if (type === Grass.type) {
      const live = engine.grass.paintData(terrain.id);
      if (live) target.set(Grass, { paintMap: encode(live.map) });
    } else if (type === Scatter.type) {
      const live = engine.scatter.paintData(target);
      if (live) target.set(Scatter, { paintMap: encode(live.map) });
    } else {
      const saved = engine.terrain.commit(terrain);
      if (!saved) return;
      terrain.set(Terrain, saved);
    }
    commitLiveEdit(target, type, before);
  };
  const onKey = (ev: KeyboardEvent) => {
    erase = ev.shiftKey;
    if (ev.type === 'keydown' && ev.key === 'Escape' && useTerrainBrush.getState().brush) {
      useTerrainBrush.setState({ brush: null });
      ev.stopImmediatePropagation();
    }
  };
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  const leave = () => (pointer = null);
  dom.addEventListener('pointerleave', leave);
  return () => {
    cancelAnimationFrame(raf);
    dom.removeEventListener('pointermove', onMove);
    dom.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    dom.removeEventListener('pointerleave', leave);
    ring.removeFromParent();
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
    viewport.brushing = false;
  };
}

