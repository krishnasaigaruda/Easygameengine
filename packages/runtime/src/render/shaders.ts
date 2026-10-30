import * as THREE from 'three';
import type { MaterialAssetData } from '../assets/types';

/*
 * Built-in material shaders. Most extend three's own lit materials (so lighting, shadows,
 * fog and sky reflections keep working) and add animated detail on top.
 */

/** Seconds since start; shared by every animated material, advanced by the Engine. */
export const shaderTime = { value: 0 };

export interface MaterialMaps {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  metalnessMap: THREE.Texture | null;
  aoMap: THREE.Texture | null;
}

const NO_MAPS: MaterialMaps = { map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null };

/** Value noise + fractal noise, and a bump helper that works on any surface. */
const NOISE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uScale;
uniform float uStrength;
varying vec3 vEgeWorld;
float egeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float egeNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(egeHash(i), egeHash(i + vec2(1.0, 0.0)), u.x), mix(egeHash(i + vec2(0.0, 1.0)), egeHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float egeFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += egeNoise(p) * a; p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
// Bump from a height value using screen-space derivatives (no tangents needed).
vec3 egeBump(vec3 surfPos, vec3 surfNorm, float h) {
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const VERTEX_WORLD = /* glsl */ `
#include <project_vertex>
vEgeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

function withShader(
  mat: THREE.Material,
  d: MaterialAssetData,
  extra: Record<string, THREE.IUniform>,
  edit: (fs: string) => string,
): THREE.Material {
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: shaderTime,
    uSpeed: { value: d.speed },
    uScale: { value: Math.max(0.01, d.patternScale) },
    uStrength: { value: d.strength },
    ...extra,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEgeWorld;')
      .replace('#include <project_vertex>', VERTEX_WORLD);
    shader.fragmentShader = edit(shader.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE_GLSL}`));
  };
  // Different settings → different program (three caches programs by this key).
  mat.customProgramCacheKey = () => `ege-${d.shader}-${'uWaveMap' in extra ? 'map' : 'nomap'}`;
  mat.userData.egeUniforms = uniforms;
  return mat;
}

function common(mat: THREE.Material, d: MaterialAssetData): THREE.Material {
  mat.side = d.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  if (d.opacity < 1) {
    mat.transparent = true;
    mat.opacity = d.opacity;
    mat.depthWrite = false;
  }
  return mat;
}

/** Make the three.js material for material settings (+ loaded texture maps). */
export function buildMaterial(d: MaterialAssetData, maps: MaterialMaps = NO_MAPS, name = ''): THREE.Material {
  switch (d.shader) {
    case 'water': {
      const mat = new THREE.MeshPhysicalMaterial({ name, color: d.color, roughness: Math.min(d.roughness, 0.25), metalness: 0, ior: 1.33, transparent: true, side: d.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
      mat.depthWrite = false;
      // A real water normal map (wave texture), if given, replaces the generated ripples.
      const wave = maps.normalMap;
      if (wave) {
        wave.wrapS = wave.wrapT = THREE.RepeatWrapping;
        wave.needsUpdate = true;
      }
      const extra: Record<string, THREE.IUniform> = { uDeep: { value: new THREE.Color(d.color2) }, uClarity: { value: 1 - d.opacity } };
      if (wave) extra.uWaveMap = { value: wave };
      const waves = wave
        ? /* glsl */ `{
              vec2 p = vEgeWorld.xz / uScale;
              float t = uTime * uSpeed;
              vec3 n1 = texture2D(uWaveMap, p * 0.5 + vec2(t * 0.020, t * 0.013)).xyz * 2.0 - 1.0;
              vec3 n2 = texture2D(uWaveMap, p * 0.83 - vec2(t * 0.011, -t * 0.024)).xyz * 2.0 - 1.0;
              float fade = 1.0 / (1.0 + length(vViewPosition) * 0.01);
              vec2 slope = (n1.xy + n2.xy) * uStrength * 0.5 * fade;
              vec3 nW = normalize(vec3(slope.x, 1.0, -slope.y)); // flat water: texture X = world X, Y = -Z
              normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
            }`
        : /* glsl */ `{
              vec2 p = vEgeWorld.xz / uScale;
              float t = uTime * uSpeed * 0.35;
              float h = egeFbm(p + vec2(t, t * 0.7)) + egeFbm(p * 1.9 - vec2(t * 0.8, -t * 0.4)) * 0.5;
              float fade = 1.0 / (1.0 + length(vViewPosition) * 0.02); // calmer far away (no shimmer)
              normal = egeBump(-vViewPosition, normal, h * uStrength * 0.08 * fade);
            }`;
      return withShader(mat, d, extra, (fs) =>
        fs
          .replace('#include <common>', `#include <common>\nuniform vec3 uDeep;\nuniform float uClarity;${wave ? '\nuniform sampler2D uWaveMap;' : ''}`)
          .replace(
            '#include <color_fragment>',
            /* glsl */ `#include <color_fragment>
            {
              vec3 V = normalize(cameraPosition - vEgeWorld);
              float facing = clamp(abs(V.y), 0.0, 1.0);
              // Looking straight down you see into the deep color; at a glance, the sky's reflection.
              diffuseColor.rgb = mix(diffuseColor.rgb, uDeep, facing);
              diffuseColor.a = mix(1.0, 0.55 + 0.45 * (1.0 - uClarity), facing);
            }`,
          )
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${waves}`),
      );
    }
    case 'lava': {
      const mat = new THREE.MeshStandardMaterial({ name, color: d.color2, roughness: 0.9, metalness: 0, flatShading: d.flatShading });
      common(mat, d);
      return withShader(mat, d, { uHot: { value: new THREE.Color(d.color) }, uGlow: { value: d.emissiveStrength } }, (fs) =>
        fs
          .replace('#include <common>', '#include <common>\nuniform vec3 uHot;\nuniform float uGlow;')
          .replace(
            '#include <emissivemap_fragment>',
            /* glsl */ `#include <emissivemap_fragment>
            {
              vec2 p = (vEgeWorld.xz + vEgeWorld.y * 0.5) / uScale;
              float t = uTime * uSpeed * 0.15;
              float n = egeFbm(p + vec2(t, -t * 0.6) + egeFbm(p * 0.7 - t) * 1.5);
              float hot = smoothstep(0.45, 0.75, n);
              float pulse = 0.85 + 0.15 * sin(uTime * uSpeed * 1.7 + n * 6.0);
              diffuseColor.rgb = mix(diffuseColor.rgb, uHot * 0.4, hot);
              totalEmissiveRadiance += uHot * hot * uGlow * 3.0 * pulse;
            }`,
          )
          .replace(
            '#include <normal_fragment_maps>',
            /* glsl */ `#include <normal_fragment_maps>
            {
              vec2 p = (vEgeWorld.xz + vEgeWorld.y * 0.5) / uScale;
              normal = egeBump(-vViewPosition, normal, egeFbm(p * 2.0) * uStrength * 0.05);
            }`,
          ),
      );
    }
    case 'glass': {
      const mat = new THREE.MeshPhysicalMaterial({
        name,
        color: d.color,
        roughness: d.roughness,
        metalness: 0,
        transmission: 1,
        thickness: Math.max(0.01, d.strength * 0.5),
        ior: 1.5,
        side: d.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        normalMap: maps.normalMap,
      });
      if (d.opacity < 1) {
        mat.transparent = true;
        mat.opacity = d.opacity;
      }
      return mat;
    }
    case 'ice': {
      const mat = new THREE.MeshPhysicalMaterial({ name, color: d.color, roughness: d.roughness, metalness: 0, transmission: 0.75, thickness: 1, ior: 1.31 });
      common(mat, d);
      return withShader(mat, d, {}, (fs) =>
        fs.replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
          {
            vec2 p = (vEgeWorld.xz + vEgeWorld.yy) / uScale;
            float cracks = 1.0 - abs(egeNoise(p * 3.0) * 2.0 - 1.0);
            normal = egeBump(-vViewPosition, normal, (egeFbm(p * 4.0) * 0.6 + pow(cracks, 8.0) * 0.4) * uStrength * 0.04);
          }`,
        ),
      );
    }
    case 'toon': {
      const steps = Math.max(2, Math.min(8, Math.round(d.toonSteps)));
      const data = new Uint8Array(steps);
      for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
      const gradient = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
      gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
      gradient.needsUpdate = true;
      const mat = new THREE.MeshToonMaterial({ name, color: d.color, map: maps.map, gradientMap: gradient, emissive: d.emissive, emissiveIntensity: d.emissiveStrength });
      return common(mat, d);
    }
    case 'unlit': {
      const mat = new THREE.MeshBasicMaterial({ name, color: d.color, map: maps.map });
      return common(mat, d);
    }
    case 'hologram':
    case 'forcefield':
      return effectMaterial(d, name);
    default: {
      const mat = new THREE.MeshStandardMaterial({
        name,
        color: d.color,
        roughness: d.roughness,
        metalness: d.metalness,
        emissive: d.emissive,
        emissiveIntensity: d.emissiveStrength,
        flatShading: d.flatShading,
        ...maps,
      });
      mat.normalScale.setScalar(d.normalScale);
      return common(mat, d);
    }
  }
}

/** See-through glowing effects (no lighting): hologram and force field. */
function effectMaterial(d: MaterialAssetData, name: string): THREE.Material {
  const field = d.shader === 'forcefield';
  const mat = new THREE.ShaderMaterial({
    name,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: field ? THREE.DoubleSide : THREE.FrontSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color(d.color) },
        uOpacity: { value: d.opacity },
        uSpeed: { value: d.speed },
        uScale: { value: Math.max(0.01, d.patternScale) },
        uStrength: { value: d.strength },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      uniform float uOpacity, uTime, uSpeed, uScale, uStrength;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - abs(dot(normalize(vNormalW), V)), 2.0);
        float t = uTime * uSpeed;
        float a;
        ${
          field
            ? `// Force field: bright edges, slowly drifting hex-ish cells, pulse.
        vec2 p = (vWorld.xy + vWorld.zz) / (uScale * 0.25);
        vec2 cell = abs(fract(p + vec2(t * 0.1, t * 0.07)) - 0.5);
        float lines = smoothstep(0.42, 0.5, max(cell.x, cell.y));
        float pulse = 0.75 + 0.25 * sin(t * 2.0);
        a = (rim * 0.9 + lines * 0.35) * pulse * uStrength;`
            : `// Hologram: rim glow, moving scanlines, flicker.
        float lines = 0.55 + 0.45 * sin((vWorld.y / (uScale * 0.02)) - t * 6.0);
        float flicker = 1.0 - uStrength * 0.25 * step(0.92, h(vec2(floor(t * 12.0), 1.0)));
        a = (0.25 + rim * 0.9) * lines * flicker;`
        }
        gl_FragColor = vec4(uColor * a * 1.6, a * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = shaderTime;
  return mat;
}

/** Ready-made materials shown first in the Asset Store (no download needed). */
export const BUILTIN_MATERIALS: { id: string; name: string; tags: string; data: Partial<MaterialAssetData> }[] = [
  { id: 'water', name: 'Water', tags: 'water lake pond river pool liquid sea', data: { shader: 'water', color: '#3f8fb0', color2: '#0b3b4f', roughness: 0.05, opacity: 0.85, patternScale: 3, strength: 1, speed: 1 } },
  { id: 'ocean', name: 'Ocean', tags: 'water ocean sea waves liquid', data: { shader: 'water', color: '#2c6f99', color2: '#04223a', roughness: 0.08, opacity: 0.95, patternScale: 9, strength: 1.6, speed: 0.8 } },
  { id: 'tropical-water', name: 'Tropical Water', tags: 'water lagoon beach shallow clear', data: { shader: 'water', color: '#5fd3d1', color2: '#127e8c', roughness: 0.04, opacity: 0.7, patternScale: 2.5, strength: 0.8, speed: 1 } },
  { id: 'swamp-water', name: 'Swamp Water', tags: 'water swamp murky bog', data: { shader: 'water', color: '#5b6b3a', color2: '#1d2414', roughness: 0.2, opacity: 0.97, patternScale: 2, strength: 0.4, speed: 0.4 } },
  { id: 'lava', name: 'Lava', tags: 'lava magma fire volcano hot glow', data: { shader: 'lava', color: '#ff5a14', color2: '#1a0d08', emissiveStrength: 1.2, patternScale: 3, strength: 1, speed: 1 } },
  { id: 'glass', name: 'Glass', tags: 'glass window clear transparent', data: { shader: 'glass', color: '#ffffff', roughness: 0.03, strength: 1 } },
  { id: 'frosted-glass', name: 'Frosted Glass', tags: 'glass frosted blurry transparent', data: { shader: 'glass', color: '#eef6ff', roughness: 0.35, strength: 1 } },
  { id: 'ice', name: 'Ice', tags: 'ice frozen snow cold crystal', data: { shader: 'ice', color: '#cfeefc', roughness: 0.12, patternScale: 1.5, strength: 1 } },
  { id: 'toon', name: 'Toon (cartoon)', tags: 'toon cartoon cel stylized anime', data: { shader: 'toon', color: '#ff8a3d', toonSteps: 3 } },
  { id: 'unlit', name: 'Unlit Color', tags: 'unlit flat 2d stylized simple', data: { shader: 'unlit', color: '#8fd16a' } },
  { id: 'low-poly', name: 'Low Poly', tags: 'low poly flat faceted stylized', data: { shader: 'standard', color: '#7fb069', roughness: 0.9, flatShading: true } },
  { id: 'neon', name: 'Neon Glow', tags: 'neon glow light emissive sign cyberpunk', data: { shader: 'standard', color: '#111111', emissive: '#ff2bd6', emissiveStrength: 4, roughness: 0.4 } },
  { id: 'hologram', name: 'Hologram', tags: 'hologram sci-fi scifi ghost projection', data: { shader: 'hologram', color: '#39d6ff', opacity: 1, patternScale: 1, strength: 1, speed: 1 } },
  { id: 'forcefield', name: 'Force Field', tags: 'force field shield bubble barrier sci-fi', data: { shader: 'forcefield', color: '#4fb6ff', opacity: 1, patternScale: 2, strength: 1, speed: 1 } },
  { id: 'chrome', name: 'Chrome', tags: 'chrome metal mirror shiny', data: { shader: 'standard', color: '#ffffff', metalness: 1, roughness: 0.05 } },
  { id: 'gold', name: 'Gold', tags: 'gold metal shiny treasure', data: { shader: 'standard', color: '#ffc85a', metalness: 1, roughness: 0.2 } },
  { id: 'plastic', name: 'Plastic', tags: 'plastic toy shiny', data: { shader: 'standard', color: '#e23b3b', metalness: 0, roughness: 0.3 } },
  { id: 'rubber', name: 'Rubber', tags: 'rubber matte black tire', data: { shader: 'standard', color: '#1c1c1c', metalness: 0, roughness: 0.95 } },
];
