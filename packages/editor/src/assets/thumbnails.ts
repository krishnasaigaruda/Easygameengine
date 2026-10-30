import { THREE, buildMaterial, defaultMaterialData, findModelParts, partNode, type Engine, type MaterialAssetData } from '@ege/runtime';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AssetMeta, AssetRecord } from '../persistence/projectStore';

const SIZE = 256;

/** One small offscreen renderer shared by all thumbnails (renders are queued, never parallel). */
let thumbRenderer: THREE.WebGLRenderer | null = null;
let studioEnv: THREE.Texture | null = null;
let queue: Promise<unknown> = Promise.resolve();

function renderer(): THREE.WebGLRenderer {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(SIZE, SIZE, false);
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(thumbRenderer);
    studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return thumbRenderer;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Thumbnail encode failed'))), 'image/webp', 0.85),
  );
}

function studioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.environment = studioEnv;
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 5, 4);
  scene.add(key, new THREE.HemisphereLight(0xffffff, 0x444444, 0.8));
  return scene;
}

/** Point the camera so `object` fills the frame from a pleasant 3/4 angle. */
function frame(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
  camera.position.copy(sphere.center).add(new THREE.Vector3(0.9, 0.55, 1.2).normalize().multiplyScalar(dist));
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  camera.lookAt(sphere.center);
}

async function render(scene: THREE.Scene, camera: THREE.Camera): Promise<Blob> {
  const r = renderer();
  r.setClearColor(0x000000, 0);
  r.render(scene, camera);
  return canvasToBlob(r.domElement);
}

/** 2: pictures with see-through parts are shown whole, small ones crisp. */
export const PICTURE_THUMB_VERSION = 2;
/** 2: the separate models inside a file (asset packs) are found, each with a preview. */
export const MODEL_THUMB_VERSION = 2;
/** Packs bigger than this show the first ones' previews only. */
const MAX_PART_THUMBS = 120;

async function imageThumbnail(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  // Pictures with see-through parts (sprites, icons) are shown whole; textures fill the square.
  const probe = document.createElement('canvas');
  probe.width = Math.min(bmp.width, 128);
  probe.height = Math.min(bmp.height, 128);
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(bmp, 0, 0, probe.width, probe.height);
  const pixels = pctx.getImageData(0, 0, probe.width, probe.height).data;
  let cutout = false;
  for (let i = 3; i < pixels.length; i += 4)
    if (pixels[i] < 200) {
      cutout = true;
      break;
    }
  const s = cutout ? Math.min(SIZE / bmp.width, SIZE / bmp.height) * 0.9 : Math.max(SIZE / bmp.width, SIZE / bmp.height);
  // Small pictures are usually pixel art: keep the pixels crisp.
  ctx.imageSmoothingEnabled = Math.max(bmp.width, bmp.height) > 128;
  ctx.drawImage(bmp, (SIZE - bmp.width * s) / 2, (SIZE - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  bmp.close();
  return canvasToBlob(canvas);
}

/**
 * Builds a preview image and reads model info (animation names, triangle count).
 * Uses the engine's AssetManager so the asset is loaded exactly the way the game will load it.
 */
export function makeThumbnail(engine: Engine, record: AssetRecord): Promise<Partial<AssetMeta>> {
  const job = queue.then(() => build(engine, record));
  queue = job.catch(() => undefined);
  return job;
}

async function build(engine: Engine, record: AssetRecord): Promise<Partial<AssetMeta>> {
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  switch (record.type) {
    case 'model': {
      const model = await engine.assets.loadModel(record.id);
      const { object } = await engine.assets.instantiate(record.id);
      let triangles = 0;
      object.traverse((o) => {
        const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
        if (g) triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      const scene = studioScene();
      scene.add(object);
      frame(camera, object);
      const thumbnail = await render(scene, camera);
      // An asset pack: a picture of each model in it, the others hidden.
      const found = findModelParts(object);
      const nodes = found.map((p) => partNode(object, p.path));
      const parts: NonNullable<AssetMeta['parts']> = [];
      for (const [i, p] of found.entries()) {
        const node = nodes[i];
        if (!node || i >= MAX_PART_THUMBS) {
          parts.push({ path: p.path, name: p.name });
          continue;
        }
        for (const n of nodes) if (n) n.visible = n === node;
        frame(camera, node);
        parts.push({ path: p.path, name: p.name, thumbnail: await render(scene, camera) });
      }
      return { thumbnail, animations: model.animations.map((a) => a.name), triangles: Math.round(triangles), parts, thumbVersion: MODEL_THUMB_VERSION };
    }
    case 'material': {
      const mat = await engine.assets.loadMaterial(record.id);
      const scene = studioScene();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 64, 32), mat);
      scene.add(ball);
      camera.position.set(0, 0.25, 1.9);
      camera.lookAt(0, 0, 0);
      const thumbnail = await render(scene, camera);
      ball.geometry.dispose();
      return { thumbnail };
    }
    case 'hdri': {
      const tex = await engine.assets.loadEnvironment(record.id);
      const scene = new THREE.Scene();
      scene.background = tex;
      camera.fov = 75;
      camera.updateProjectionMatrix();
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0.15, -1);
      return { thumbnail: await render(scene, camera) };
    }
    case 'texture': {
      const blob = record.files[record.main];
      return blob ? { thumbnail: await imageThumbnail(blob), thumbVersion: PICTURE_THUMB_VERSION } : {};
    }
    default:
      return {};
  }
}

/** Preview image (object URL) of material settings on a ball — for built-in store items. */
export function materialPreview(data: Partial<MaterialAssetData>): Promise<string> {
  const job = queue.then(async () => {
    const mat = buildMaterial({ ...defaultMaterialData(), ...data });
    const scene = studioScene();
    scene.background = new THREE.Color('#2a2d33'); // see-through materials need something behind them
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 64, 32), mat);
    scene.add(ball);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0, 0.25, 1.9);
    camera.lookAt(0, 0, 0);
    const blob = await render(scene, camera);
    ball.geometry.dispose();
    mat.dispose();
    return URL.createObjectURL(blob);
  });
  queue = job.catch(() => undefined);
  return job;
}
