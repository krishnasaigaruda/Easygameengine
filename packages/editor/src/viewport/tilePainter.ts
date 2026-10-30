import { THREE, Tilemap, cellKey, type Engine, type Entity, type TilemapData } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { useTileBrush } from '../editor/tileBrush';
import { commitLiveEdit } from '../editor/actions';
import type { EditorViewport } from './EditorViewport';

/**
 * Tilemap painting in the viewport: a square shows the cell under the mouse; holding the left
 * button paints the chosen tile (Shift, or the Erase brush, removes). One stroke = one undo step.
 */
export function attachTilePainter(engine: Engine, viewport: EditorViewport): () => void {
  const dom = engine.renderer.domElement;
  const ray = new THREE.Raycaster();
  const cursor = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0)),
    new THREE.LineBasicMaterial({ color: 0xe0b23a, depthTest: false, transparent: true }),
  );
  cursor.renderOrder = 999;
  cursor.userData.editorOnly = true;
  cursor.visible = false;
  engine.scene.add(cursor);

  let pointer: { x: number; y: number } | null = null;
  let shift = false;
  let stroke: { map: Entity; before: TilemapData; last: string } | null = null;
  let raf = 0;

  const active = (): Entity | null => {
    const s = useEditor.getState();
    if (!useTileBrush.getState().active || s.playing || viewport.gameView || !s.selection) return null;
    const e = s.engine?.world.getById(s.selection);
    return e?.has(Tilemap) ? e : null;
  };

  /** The cell under the mouse, in the tilemap's own grid. */
  const cellAt = (e: Entity): { x: number; y: number } | null => {
    const node = engine.render.nodeOf(e);
    if (!node || !pointer) return null;
    const r = dom.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((pointer.x - r.left) / r.width) * 2 - 1, -((pointer.y - r.top) / r.height) * 2 + 1), engine.camera);
    node.updateWorldMatrix(true, false);
    const origin = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(node.matrixWorld));
    const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), new THREE.Vector3());
    if (!hit) return null;
    const local = node.worldToLocal(hit);
    const size = e.require(Tilemap).tileSize;
    return { x: Math.floor(local.x / size), y: Math.floor(local.y / size) };
  };

  const paint = (e: Entity, cell: { x: number; y: number }) => {
    const key = cellKey(cell.x, cell.y);
    if (stroke?.last === key) return;
    if (stroke) stroke.last = key;
    const d = e.require(Tilemap);
    const b = useTileBrush.getState();
    const erase = b.erase || shift;
    if (erase ? !(key in d.cells) : d.cells[key] === b.tile) return;
    const cells = { ...d.cells };
    if (erase) delete cells[key];
    else cells[key] = b.tile;
    e.set(Tilemap, { cells });
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const e = active();
    viewport.brushing = !!e || viewport.brushing;
    const cell = e ? cellAt(e) : null;
    cursor.visible = !!cell;
    if (!e || !cell) return;
    const node = engine.render.nodeOf(e)!;
    const size = e.require(Tilemap).tileSize;
    cursor.matrixAutoUpdate = false;
    cursor.matrix
      .copy(node.matrixWorld)
      .multiply(new THREE.Matrix4().makeTranslation(cell.x * size, cell.y * size, 0.01))
      .multiply(new THREE.Matrix4().makeScale(size, size, 1));
    (cursor.material as THREE.LineBasicMaterial).color.setHex(useTileBrush.getState().erase || shift ? 0xff5a4a : 0xe0b23a);
    if (stroke?.map === e) paint(e, cell);
  };
  raf = requestAnimationFrame(tick);

  const onMove = (ev: PointerEvent) => {
    pointer = { x: ev.clientX, y: ev.clientY };
    shift = ev.shiftKey;
  };
  const onDown = (ev: PointerEvent) => {
    pointer = { x: ev.clientX, y: ev.clientY };
    shift = ev.shiftKey;
    const e = active();
    if (!e || ev.button !== 0) return;
    const cell = cellAt(e);
    if (!cell) return;
    ev.preventDefault();
    ev.stopImmediatePropagation(); // no picking or dragging while painting
    stroke = { map: e, before: structuredClone(e.require(Tilemap)), last: '' };
    paint(e, cell);
  };
  const onUp = () => {
    if (!stroke) return;
    const { map, before } = stroke;
    stroke = null;
    commitLiveEdit(map, Tilemap.type, before);
  };
  const onKey = (ev: KeyboardEvent) => {
    shift = ev.shiftKey;
    if (ev.type === 'keydown' && ev.key === 'Escape' && useTileBrush.getState().active) {
      useTileBrush.setState({ active: false });
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
    cursor.removeFromParent();
    cursor.geometry.dispose();
    (cursor.material as THREE.Material).dispose();
  };
}
