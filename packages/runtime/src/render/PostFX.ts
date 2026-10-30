import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import type { PostProcessingData } from '../components/environment';

/**
 * Contrast / saturation / warmth / vignette in one pass (linear color, before tone mapping), plus
 * the retro and film looks: big pixels, fewer colours, grain.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1 },
    saturation: { value: 1 },
    warmth: { value: 0 },
    vignette: { value: 0 },
    pixelSize: { value: 1 },
    colorLevels: { value: 0 },
    grain: { value: 0 },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, warmth, vignette, pixelSize, colorLevels, grain, time;
    uniform vec2 resolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      // Retro: every block of pixelSize × pixelSize screen pixels shows one colour.
      vec2 uv = vUv;
      if (pixelSize > 1.0) {
        vec2 cell = pixelSize / resolution;
        uv = (floor(vUv / cell) + 0.5) * cell;
      }
      vec4 c = texture2D(tDiffuse, uv);
      vec3 col = c.rgb;
      // Contrast around mid-grey in a perceptual-ish space.
      vec3 g = pow(max(col, 0.0), vec3(1.0 / 2.2));
      g = (g - 0.5) * contrast + 0.5;
      if (colorLevels > 0.0) g = floor(clamp(g, 0.0, 1.0) * colorLevels + 0.5) / colorLevels;
      col = pow(max(g, 0.0), vec3(2.2));
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col *= vec3(1.0 + warmth * 0.12, 1.0 + warmth * 0.03, 1.0 - warmth * 0.12);
      float d = distance(vUv, vec2(0.5));
      // (smoothstep needs its edges in order: reversed ones are undefined and fail on some GPUs.)
      // Darkening as seen (perceptual), converted to linear light.
      col *= pow(mix(1.0, 1.0 - smoothstep(0.25, 0.85, d), vignette), 2.2);
      if (grain > 0.0) {
        float n = hash(floor(vUv * resolution) + fract(time * 7.13) * 100.0) - 0.5;
        col *= 1.0 + n * grain * 0.6;
      }
      gl_FragColor = vec4(col, c.a);
    }`,
};

/** Cartoon outlines: dark lines where the depth jumps (silhouettes and overlapping shapes). */
const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    ortho: { value: 0 },
    strength: { value: 1 },
    width: { value: 1.5 },
    color: { value: new THREE.Color('#141414') },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 resolution;
    uniform float cameraNear, cameraFar, ortho, strength, width;
    uniform vec3 color;
    varying vec2 vUv;
    float viewZ(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      float z = ortho > 0.5 ? orthographicDepthToViewZ(d, cameraNear, cameraFar) : perspectiveDepthToViewZ(d, cameraNear, cameraFar);
      return -z;
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 o = width / resolution;
      float z = viewZ(vUv);
      float zl = viewZ(vUv - vec2(o.x, 0.0)), zr = viewZ(vUv + vec2(o.x, 0.0));
      float zd = viewZ(vUv - vec2(0.0, o.y)), zu = viewZ(vUv + vec2(0.0, o.y));
      // How far the nearest neighbour is in front of / behind, relative to the distance.
      float jump = max(max(abs(zl - z), abs(zr - z)), max(abs(zd - z), abs(zu - z))) / max(z, 0.001);
      float edge = smoothstep(0.04, 0.12, jump);
      // Nothing behind the sky.
      if (z > cameraFar * 0.98) edge *= 0.0;
      gl_FragColor = vec4(mix(c.rgb, color, edge * strength), c.a);
    }`,
};

const TONE: Record<PostProcessingData['toneMapping'], THREE.ToneMapping> = {
  ACES: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
  None: THREE.NoToneMapping,
};

/** Reads the depth of whatever buffer it's given (the composer swaps its two buffers). */
class OutlinePass extends ShaderPass {
  constructor() {
    super(OutlineShader);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

/** Post-processing chain, created on first use and only used while a Post Processing component exists. */
export class PostFX {
  private composer: EffectComposer | null = null;
  private renderPass!: RenderPass;
  private bloom!: UnrealBloomPass;
  private grade!: ShaderPass;
  private outline!: OutlinePass;
  private readonly timer = new THREE.Timer();
  private smaa!: SMAAPass;
  private fxaa!: FXAAPass;
  private readonly size = new THREE.Vector2();
  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /**
   * @param cheap low quality: the look stays (outlines, colours, retro pixels), glow and edge
   *   smoothing are skipped
   */
  render(scene: THREE.Scene, camera: THREE.Camera, d: PostProcessingData, cheap = false): void {
    const r = this.renderer;
    if (!this.composer) {
      // Both buffers keep their depth, for the outlines.
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
      this.composer = new EffectComposer(r, target);
      this.renderPass = new RenderPass(scene, camera);
      this.outline = new OutlinePass();
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), d.bloomStrength, d.bloomRadius, d.bloomThreshold);
      this.grade = new ShaderPass(GradeShader);
      this.smaa = new SMAAPass();
      this.fxaa = new FXAAPass();
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.outline);
      this.composer.addPass(this.bloom);
      this.composer.addPass(this.grade);
      this.composer.addPass(new OutputPass());
      this.composer.addPass(this.smaa);
      this.composer.addPass(this.fxaa);
    }
    r.getSize(this.size);
    const pr = r.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.size.x, this.size.y);
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    const px = new THREE.Vector2(this.size.x * pr, this.size.y * pr);
    const outlined = (d.outline ?? 0) > 0;
    this.outline.enabled = outlined;
    if (outlined) {
      const ou = this.outline.uniforms;
      const cam = camera as THREE.PerspectiveCamera;
      (ou.resolution.value as THREE.Vector2).copy(px);
      ou.cameraNear.value = cam.near ?? 0.1;
      ou.cameraFar.value = cam.far ?? 1000;
      ou.ortho.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
      ou.strength.value = d.outline;
      ou.width.value = (d.outlineWidth ?? 1.5) * pr;
      (ou.color.value as THREE.Color).set(d.outlineColor ?? '#141414');
    }
    this.bloom.enabled = !cheap && d.bloom && d.bloomStrength > 0;
    this.bloom.strength = d.bloomStrength;
    this.bloom.radius = d.bloomRadius;
    this.bloom.threshold = d.bloomThreshold;
    const u = this.grade.uniforms as Record<string, { value: number }>;
    u.contrast.value = d.contrast;
    u.saturation.value = d.saturation;
    u.warmth.value = d.warmth;
    u.vignette.value = d.vignette;
    u.pixelSize.value = Math.max(1, (d.pixelSize ?? 1) * pr);
    u.colorLevels.value = d.colorLevels ?? 0;
    u.grain.value = d.grain ?? 0;
    this.timer.update();
    u.time.value = this.timer.getElapsed();
    (this.grade.uniforms.resolution.value as THREE.Vector2).copy(px);
    this.smaa.enabled = !cheap && d.antiAliasing === 'SMAA';
    this.fxaa.enabled = !cheap && d.antiAliasing === 'FXAA';
    r.toneMapping = TONE[d.toneMapping] ?? THREE.ACESFilmicToneMapping;
    this.composer.render();
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
  }
}
