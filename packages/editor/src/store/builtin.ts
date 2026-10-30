import { BUILTIN_MATERIALS, PARTICLE_PRESETS, type MaterialAssetData } from '@ege/runtime';
import { materialPreview } from '../assets/thumbnails';
import { words, type StoreItem } from './catalog';

/**
 * Water presets that use real water wave textures (normal maps) from the three.js project
 * (MIT license), fetched from the jsDelivr CDN when added.
 */
const THREE_TEXTURES = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/';
export const WEB_WATER: { id: string; name: string; tags: string; file: string; data: Partial<MaterialAssetData> }[] = [
  { id: 'real-water', name: 'Realistic Water', tags: 'water lake pond river pool realistic waves texture', file: 'water/Water_1_M_Normal.jpg', data: { shader: 'water', color: '#3f8fb0', color2: '#0b3b4f', roughness: 0.04, opacity: 0.85, patternScale: 6, strength: 0.9, speed: 1 } },
  { id: 'real-ocean', name: 'Realistic Ocean', tags: 'water ocean sea waves realistic texture', file: 'waternormals.jpg', data: { shader: 'water', color: '#2a6a93', color2: '#03203a', roughness: 0.05, opacity: 0.95, patternScale: 14, strength: 1.2, speed: 1.4 } },
  { id: 'real-lake', name: 'Realistic Calm Lake', tags: 'water lake calm still realistic texture', file: 'water/Water_2_M_Normal.jpg', data: { shader: 'water', color: '#4a8aa0', color2: '#0f3340', roughness: 0.03, opacity: 0.9, patternScale: 10, strength: 0.45, speed: 0.5 } },
];

let builtin: Promise<StoreItem[]> | null = null;

/** Easy Game Engine's own shader materials (water, lava, glass…): nothing to download. */
export function loadBuiltinMaterials(): Promise<StoreItem[]> {
  builtin ??= (async () => {
    const items: StoreItem[] = [];
    for (const m of WEB_WATER) {
      items.push({
        key: `web:${m.id}`,
        provider: 'builtin',
        kind: 'material',
        id: m.id,
        name: m.name,
        author: 'three.js (MIT)',
        license: 'MIT',
        // The wave texture itself is the preview: you can see the real water detail.
        thumbs: [`${THREE_TEXTURES}${m.file}`],
        animations: 0,
        categories: ['built-in'],
        nameWords: words(m.name),
        tagWords: words(`${m.tags} built-in shader water`),
        authorText: 'three.js',
        pageUrl: 'https://github.com/mrdoob/three.js',
        fileUrl: `${THREE_TEXTURES}${m.file}`,
      });
    }
    for (const m of BUILTIN_MATERIALS) {
      const thumb = await materialPreview(m.data).catch(() => '');
      items.push({
        key: `builtin:${m.id}`,
        provider: 'builtin',
        kind: 'material',
        id: m.id,
        name: m.name,
        author: 'Easy Game Engine',
        license: 'CC0-1.0',
        thumbs: thumb ? [thumb] : [],
        animations: 0,
        categories: ['built-in'],
        nameWords: words(m.name),
        tagWords: words(`${m.tags} built-in shader ${m.data.shader ?? ''}`),
        authorText: 'easy game engine',
        pageUrl: '',
      });
    }
    return items;
  })();
  builtin.catch(() => (builtin = null));
  return builtin;
}

/** Built-in particle effects (fire, smoke, magic…): Add puts one in the scene. */
export function builtinEffects(): StoreItem[] {
  return Object.entries(PARTICLE_PRESETS).map(([name, data]) => ({
    key: `fx:${name}`,
    provider: 'builtin',
    kind: 'effect',
    id: name,
    name,
    author: 'Easy Game Engine',
    license: 'CC0-1.0',
    thumbs: [effectPreview(data)],
    animations: 0,
    categories: [data.glow ? 'glowing' : 'soft'],
    nameWords: words(name),
    tagWords: words(`effect particles vfx ${name}`),
    authorText: 'easy game engine',
    pageUrl: '',
  }));
}

/** A quick picture of an effect: particles drawn with its own colors, sizes and direction. */
function effectPreview(d: Partial<import('@ege/runtime').ParticleSystemData>): string {
  if (typeof document === 'undefined') return '';
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return '';
  g.fillStyle = '#1b1d22';
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = d.glow ? 'lighter' : 'source-over';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const from = d.color ?? '#ffffff';
  const to = d.colorEnd ?? from;
  const mix = (a: string, b: string, t: number) => {
    const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
  };
  const rising = (d.gravity ?? 0) < 0;
  const n = 120;
  for (let i = 0; i < n; i++) {
    const t = rnd(); // age 0..1
    const spread = ((d.spread ?? 30) / 180) * 0.9 + (d.radius ?? 0.2) * 0.15;
    const x = size / 2 + (rnd() - 0.5) * size * spread * (0.4 + t);
    const travel = t * size * 0.7 * Math.min(1, ((d.speed ?? 1) + 0.3) / 2);
    const y = rising ? size * 0.85 - travel : (d.gravity ?? 0) > 0.3 ? size * 0.15 + travel : size / 2 + (rnd() - 0.5) * size * 0.6;
    const r = Math.max(1.5, ((d.size ?? 0.2) + ((d.sizeEnd ?? 0.2) - (d.size ?? 0.2)) * t) * 70);
    g.globalAlpha = Math.max(0.05, (d.opacity ?? 1) + ((d.opacityEnd ?? 0) - (d.opacity ?? 1)) * t) * 0.6;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, mix(from, to, t));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return c.toDataURL('image/png');
}
