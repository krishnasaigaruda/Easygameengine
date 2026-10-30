import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Built-in plants drawn the way game engines do it: textured cards (flat quads cut out by the
 * picture's transparency) for petals, leaves, grass blades and fern fronds. The pictures are
 * painted at runtime on a canvas, so nothing has to be downloaded.
 */

/** Paint a texture on a canvas. Null where there's no canvas (tests run without a browser). */
function painted(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const cache = new Map<string, THREE.Texture | null>();
const once = (key: string, make: () => THREE.Texture | null) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key)!;
};

/** One petal / leaf: a pointed oval, lighter toward the tip, with a middle vein. */
function bladeShape(g: CanvasRenderingContext2D, w: number, h: number, base: string, tip: string, vein: string, roundness: number): void {
  const grad = g.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, base);
  grad.addColorStop(1, tip);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(w / 2, h);
  g.bezierCurveTo(w * (0.5 - roundness), h * 0.7, w * (0.5 - roundness), h * 0.15, w / 2, 0);
  g.bezierCurveTo(w * (0.5 + roundness), h * 0.15, w * (0.5 + roundness), h * 0.7, w / 2, h);
  g.fill();
  g.strokeStyle = vein;
  g.lineWidth = Math.max(1, w * 0.03);
  g.beginPath();
  g.moveTo(w / 2, h);
  g.lineTo(w / 2, h * 0.12);
  g.stroke();
}

const petalTexture = () =>
  once('petal', () => painted(64, 128, (g, w, h) => bladeShape(g, w, h, '#f2efe8', '#ffffff', 'rgba(0,0,0,0.12)', 0.55)));
const leafTexture = () =>
  once('leaf', () => painted(64, 128, (g, w, h) => bladeShape(g, w, h, '#9bb08a', '#dfe8d2', 'rgba(40,60,20,0.35)', 0.5)));

/** A tuft of blades rising from the bottom edge (light, so the plant's color tints it). */
const grassTexture = () =>
  once('grass', () =>
    painted(256, 256, (g, w, h) => {
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 22; i++) {
        const x = w * (0.12 + rnd() * 0.76);
        const top = h * (0.05 + rnd() * 0.45);
        const lean = (rnd() - 0.5) * w * 0.35;
        const width = w * (0.02 + rnd() * 0.025);
        const grad = g.createLinearGradient(0, h, 0, top);
        const shade = 150 + Math.floor(rnd() * 70);
        grad.addColorStop(0, `rgb(${shade * 0.55},${shade * 0.7},${shade * 0.45})`);
        grad.addColorStop(1, `rgb(${shade},${Math.min(255, shade + 30)},${shade * 0.75})`);
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(x - width, h);
        g.quadraticCurveTo(x - width * 0.5 + lean * 0.4, (h + top) / 2, x + lean, top);
        g.quadraticCurveTo(x + width * 0.5 + lean * 0.4, (h + top) / 2, x + width, h);
        g.fill();
      }
    }),
  );

/** A fern frond: a stem with leaflets getting smaller toward the tip. */
const frondTexture = () =>
  once('frond', () =>
    painted(128, 256, (g, w, h) => {
      g.strokeStyle = '#7f9a66';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(w / 2, h);
      g.lineTo(w / 2, 4);
      g.stroke();
      for (let i = 0; i < 18; i++) {
        const t = i / 18;
        const y = h * (0.95 - t * 0.9);
        const len = w * 0.46 * (1 - t * 0.85);
        for (const side of [-1, 1]) {
          const grad = g.createLinearGradient(w / 2, y, w / 2 + side * len, y - len * 0.3);
          grad.addColorStop(0, '#a9c391');
          grad.addColorStop(1, '#d9e8c6');
          g.fillStyle = grad;
          g.beginPath();
          g.moveTo(w / 2, y);
          g.quadraticCurveTo(w / 2 + side * len * 0.5, y - len * 0.25, w / 2 + side * len, y - len * 0.35);
          g.quadraticCurveTo(w / 2 + side * len * 0.5, y + len * 0.05, w / 2, y + h * 0.02);
          g.fill();
        }
      }
    }),
  );

/**
 * Foliage material: cut out by the picture, both sides lit the same (a leaf seen from behind
 * isn't black), normals mostly up so lighting is soft like real plants.
 */
export function foliageMaterial(color: THREE.ColorRepresentation, map: THREE.Texture | null, roughness = 0.85): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, map, roughness, metalness: 0, side: THREE.DoubleSide, alphaTest: map ? 0.45 : 0 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'ege-foliage';
  return mat;
}

/**
 * A card: a quad standing on y = 0, curved backward along its height, with normals tilted up.
 * `bend` is how far the tip leans back (in units of its height).
 */
function card(width: number, height: number, bend = 0, segments = 4): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, 1, segments).translate(0, height / 2, 0);
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    pos.setZ(i, -bend * height * t * t);
    nrm.setXYZ(i, 0, 0.8, 0.6);
  }
  return g;
}

/** Several cards merged into one geometry (one draw). */
function cards(list: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const parts = list.map(({ geometry, matrix }) => geometry.applyMatrix4(matrix));
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      const v = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).normalize();
      nrm.push(v.x, v.y, v.z);
      uv.push(u.getX(i), u.getY(i));
    }
    for (const i of g.index!.array) idx.push(i + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

const turn = (yaw: number, tilt = 0, at = new THREE.Vector3()) =>
  new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));

export interface PlantPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  tinted?: boolean;
  /** Colors the copies cycle through when tinted (default: flower colors). */
  palette?: THREE.Color[];
  local: THREE.Matrix4;
}

const AUTUMN = ['#8a5a2b', '#a86f2e', '#6f4a26', '#9b7b3a', '#7a3f22', '#b58a43'].map((c) => new THREE.Color(c));
const STONE = ['#6f6b64', '#625e57', '#7a756c', '#56524c', '#73695d'].map((c) => new THREE.Color(c));

/** A handful of fallen leaves lying on the ground (each copy a different autumn color). */
export function fallenLeavesParts(): PlantPart[] {
  const mat = foliageMaterial('#ffffff', leafTexture(), 0.95);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const list = Array.from({ length: 14 }, () => {
    const r = Math.sqrt(rnd()) * 0.45;
    const a = rnd() * Math.PI * 2;
    // Flat on the ground, slightly curled, pointing any way.
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * r, 0.01 + rnd() * 0.01, Math.sin(a) * r),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (rnd() - 0.5) * 0.4, rnd() * Math.PI * 2, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    return { geometry: card(0.06 + rnd() * 0.03, 0.1 + rnd() * 0.04, 0.15, 2), matrix: m };
  });
  return [{ geometry: cards(list), material: mat, local: new THREE.Matrix4(), tinted: true, palette: AUTUMN }];
}

/** A few small stones, half sunk into the ground (each copy a slightly different gray). */
export function pebblesParts(): PlantPart[] {
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stones: THREE.BufferGeometry[] = [];
  for (let s = 0; s < 6; s++) {
    const g = new THREE.IcosahedronGeometry(0.03 + rnd() * 0.05, 1);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.8 + rnd() * 0.5), pos.getY(i) * (0.45 + rnd() * 0.3), pos.getZ(i) * (0.8 + rnd() * 0.5));
    const r = Math.sqrt(rnd()) * 0.4;
    const a = rnd() * Math.PI * 2;
    g.rotateY(rnd() * Math.PI);
    g.translate(Math.cos(a) * r, 0.005, Math.sin(a) * r);
    stones.push(g.toNonIndexed());
  }
  const merged = mergeGeometries(stones, false)!;
  merged.computeVertexNormals();
  for (const g of stones) g.dispose();
  return [{ geometry: merged, material: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), local: new THREE.Matrix4(), tinted: true, palette: STONE }];
}

/** A wild flower: thin stem, two leaves, and a head of real petals (each copy gets its own color). */
export function flowerParts(stemColor: THREE.Color): PlantPart[] {
  const stemMat = foliageMaterial(stemColor, leafTexture());
  const petalMat = foliageMaterial('#ffffff', petalTexture(), 0.6);
  const centerMat = new THREE.MeshStandardMaterial({ color: '#d9a21f', roughness: 0.8 });
  const stemH = 0.36;
  const stem = new THREE.CylinderGeometry(0.004, 0.006, stemH, 4).translate(0, stemH / 2, 0);
  const leaves = cards([
    { geometry: card(0.05, 0.16, 0.35), matrix: turn(0.4, 0.5) },
    { geometry: card(0.045, 0.13, 0.35), matrix: turn(0.4 + Math.PI, 0.6) },
  ]);
  const petals = cards(
    Array.from({ length: 9 }, (_, i) => ({
      geometry: card(0.026, 0.05, -0.15, 2),
      // Laid out flat around the center, cupped up a little.
      matrix: turn((i / 9) * Math.PI * 2, Math.PI / 2 - 0.35, new THREE.Vector3(0, stemH, 0)),
    })),
  );
  const at = (y: number) => new THREE.Matrix4().makeTranslation(0, y, 0);
  return [
    { geometry: stem, material: new THREE.MeshStandardMaterial({ color: stemColor, roughness: 0.9 }), local: new THREE.Matrix4() },
    { geometry: leaves, material: stemMat, local: new THREE.Matrix4() },
    { geometry: petals, material: petalMat, local: new THREE.Matrix4(), tinted: true },
    { geometry: new THREE.SphereGeometry(0.011, 6, 4), material: centerMat, local: at(stemH + 0.004) },
  ];
}

/** A tuft of grass: three crossed cards of blades. */
export function grassClumpParts(color: THREE.Color): PlantPart[] {
  const mat = foliageMaterial(color, grassTexture(), 0.9);
  const geometry = cards([0, 1, 2].map((i) => ({ geometry: card(0.55, 0.5, 0.15), matrix: turn((i / 3) * Math.PI) })));
  return [{ geometry, material: mat, local: new THREE.Matrix4() }];
}

/** A fern: arching fronds around the middle. */
export function fernParts(color: THREE.Color): PlantPart[] {
  const mat = foliageMaterial(color, frondTexture(), 0.85);
  const geometry = cards(Array.from({ length: 7 }, (_, i) => ({ geometry: card(0.32, 0.75, 0.55, 6), matrix: turn((i / 7) * Math.PI * 2 + 0.3, 0.35) })));
  return [{ geometry, material: mat, local: new THREE.Matrix4() }];
}

/** A bush: a dense ball of leaf cards. */
export function bushParts(color: THREE.Color): PlantPart[] {
  const mat = foliageMaterial(color, leafTexture(), 0.9);
  const list: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    // Points spread over a squashed ball, each leaf pointing outward.
    const yaw = rnd() * Math.PI * 2;
    const up = rnd() * 0.9 + 0.05;
    const r = 0.45 + rnd() * 0.2;
    const at = new THREE.Vector3(Math.sin(yaw) * r * Math.sqrt(1 - up * up) * 1.3, 0.05 + up * 0.75, Math.cos(yaw) * r * Math.sqrt(1 - up * up) * 1.3);
    list.push({ geometry: card(0.16, 0.26, 0.2, 2), matrix: turn(yaw + (rnd() - 0.5), 0.6 + rnd() * 0.6, at) });
  }
  return [{ geometry: cards(list), material: mat, local: new THREE.Matrix4() }];
}
