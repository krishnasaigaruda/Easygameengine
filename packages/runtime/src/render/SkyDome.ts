import * as THREE from 'three';

/*
 * Easy Game Engine's sky: a dome drawn with one shader. It blends two "looks" — each either
 * built-in colors or a skybox image — so every time of day can have its own sky, with smooth
 * transitions in between. Adds a sun, moon, stars and clouds on top.
 */

export interface SkyLook {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  /** Optional skybox image (equirectangular) for this look. */
  texture: THREE.Texture | null;
}

export interface SkyFrame {
  a: SkyLook;
  b: SkyLook;
  /** 0 = all A, 1 = all B. */
  blend: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** 0 hides the sun (night). */
  sunStrength: number;
  sunSize: number;
  stars: number;
  moon: number;
  clouds: number;
  cloudSpeed: number;
  skyboxBrightness: number;
  time: number;
}

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // always behind everything
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenithA, uHorizonA, uGroundA, uZenithB, uHorizonB, uGroundB;
uniform sampler2D uTexA, uTexB;
uniform float uUseTexA, uUseTexB, uBlend, uTexBrightness;
uniform vec3 uSunDir, uSunColor;
uniform float uSunStrength, uSunSize, uStars, uMoon, uClouds, uCloudSpeed, uTime, uShowSun;
varying vec3 vWorld;

#define PI 3.141592653589793

vec3 gradient(vec3 d, vec3 zen, vec3 hor, vec3 gnd) {
  float y = d.y;
  if (y >= 0.0) return mix(hor, zen, pow(y, 0.45));
  return mix(hor, gnd, pow(min(1.0, -y * 3.0), 0.6));
}

vec3 equirect(sampler2D t, vec3 d) {
  vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
  return texture2D(t, uv).rgb * uTexBrightness;
}

float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5453);
  float e = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += noise2(p) * a; p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  vec3 colA = uUseTexA > 0.5 ? equirect(uTexA, d) : gradient(d, uZenithA, uHorizonA, uGroundA);
  vec3 colB = uUseTexB > 0.5 ? equirect(uTexB, d) : gradient(d, uZenithB, uHorizonB, uGroundB);
  vec3 col = mix(colA, colB, uBlend);
  float above = smoothstep(-0.02, 0.05, d.y);

  // Stars: tiny points on a fine grid of directions, twinkling.
  if (uStars > 0.0) {
    vec3 p = d * 260.0;
    vec3 cell = floor(p);
    float h = hash3(cell);
    float star = step(0.9965, h) * (1.0 - smoothstep(0.05, 0.5, length(fract(p) - 0.5)));
    float twinkle = 0.65 + 0.35 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
    col += vec3(star * twinkle * uStars * above * 1.6);
  }

  // Sun: disc + soft glow (hidden at night and when a skybox already has its own sun).
  float cosSun = dot(d, normalize(uSunDir));
  float disc = smoothstep(1.0 - 0.00012 * uSunSize, 1.0 - 0.00004 * uSunSize, cosSun);
  float glow = pow(max(cosSun, 0.0), 220.0 / uSunSize) * 0.6 + pow(max(cosSun, 0.0), 8.0) * 0.12;
  col += uSunColor * (disc * 18.0 + glow) * uSunStrength * uShowSun * above;

  // Moon: opposite-ish the sun, pale and soft.
  if (uMoon > 0.0) {
    vec3 moonDir = normalize(vec3(-uSunDir.x, abs(uSunDir.y) * 0.8 + 0.25, -uSunDir.z));
    float cm = dot(d, moonDir);
    float mdisc = smoothstep(0.99955, 0.99975, cm);
    float mglow = pow(max(cm, 0.0), 300.0) * 0.25;
    col += vec3(0.85, 0.9, 1.0) * (mdisc * 1.6 + mglow) * uMoon * above;
  }

  // Clouds: a flat cloud layer high above, drifting with the wind.
  if (uClouds > 0.0 && d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.01 * uCloudSpeed, uTime * 0.004 * uCloudSpeed);
    float n = fbm2(uv);
    float cover = smoothstep(1.0 - uClouds * 0.85, 1.0 - uClouds * 0.85 + 0.25, n);
    float lit = 0.75 + 0.25 * max(0.0, cosSun);
    vec3 cloudCol = mix(col * 1.1 + 0.05, uSunColor * 0.6 + mix(uHorizonA, uHorizonB, uBlend) * 0.6, 0.6) * lit;
    col = mix(col, cloudCol, cover * smoothstep(0.0, 0.15, d.y) * 0.95);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

export class SkyDome extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor() {
    const u = {
      uZenithA: { value: new THREE.Color() },
      uHorizonA: { value: new THREE.Color() },
      uGroundA: { value: new THREE.Color() },
      uZenithB: { value: new THREE.Color() },
      uHorizonB: { value: new THREE.Color() },
      uGroundB: { value: new THREE.Color() },
      uTexA: { value: BLACK as THREE.Texture },
      uTexB: { value: BLACK as THREE.Texture },
      uUseTexA: { value: 0 },
      uUseTexB: { value: 0 },
      uBlend: { value: 0 },
      uTexBrightness: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunStrength: { value: 1 },
      uSunSize: { value: 1 },
      uShowSun: { value: 1 },
      uStars: { value: 0 },
      uMoon: { value: 0 },
      uClouds: { value: 0 },
      uCloudSpeed: { value: 1 },
      uTime: { value: 0 },
    };
    super(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.frustumCulled = false;
    this.renderOrder = -1000;
  }

  update(f: SkyFrame, showSun = true): void {
    const u = this.material.uniforms;
    const look = (l: SkyLook, s: 'A' | 'B') => {
      (u[`uZenith${s}`].value as THREE.Color).copy(l.zenith);
      (u[`uHorizon${s}`].value as THREE.Color).copy(l.horizon);
      (u[`uGround${s}`].value as THREE.Color).copy(l.ground);
      u[`uTex${s}`].value = l.texture ?? BLACK;
      u[`uUseTex${s}`].value = l.texture ? 1 : 0;
    };
    look(f.a, 'A');
    look(f.b, 'B');
    u.uBlend.value = f.blend;
    u.uTexBrightness.value = f.skyboxBrightness;
    (u.uSunDir.value as THREE.Vector3).copy(f.sunDir);
    (u.uSunColor.value as THREE.Color).copy(f.sunColor);
    u.uSunStrength.value = f.sunStrength;
    u.uSunSize.value = f.sunSize;
    // Skybox images usually include their own sun.
    u.uShowSun.value = showSun && !(f.a.texture && f.b.texture) ? 1 : 0;
    u.uStars.value = f.stars;
    u.uMoon.value = f.moon;
    u.uClouds.value = f.clouds;
    u.uCloudSpeed.value = f.cloudSpeed;
    u.uTime.value = f.time;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
