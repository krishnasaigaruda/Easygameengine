import * as THREE from 'three';

/*
 * 2D lighting: sprites and tilemaps are unlit pictures, so 2D lights are added in their shader.
 * Every lit material shares these uniforms; Light2DSystem fills them once a frame.
 */

export const MAX_LIGHTS_2D = 16;

export const light2DUniforms = {
  /** 0 = off (no 2D lights and no darkness: pictures show as they are). */
  uLight2DOn: { value: 0 },
  /** Brightness where no light reaches (1 = full daylight). */
  uAmbient2D: { value: 1 },
  uLight2DCount: { value: 0 },
  /** x, y and reach of each light. */
  uLight2DPos: { value: Array.from({ length: MAX_LIGHTS_2D }, () => new THREE.Vector3()) },
  /** Colour × brightness of each light. */
  uLight2DColor: { value: Array.from({ length: MAX_LIGHTS_2D }, () => new THREE.Vector3()) },
};

/** Make an unlit (MeshBasicMaterial) picture respond to 2D lights. */
export function litBy2DLights<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, light2DUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vWorld2D;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vWorld2D = (modelMatrix * vec4(transformed, 1.0)).xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec2 vWorld2D;
uniform float uLight2DOn;
uniform float uAmbient2D;
uniform int uLight2DCount;
uniform vec3 uLight2DPos[${MAX_LIGHTS_2D}];
uniform vec3 uLight2DColor[${MAX_LIGHTS_2D}];
void main() {`,
      )
      .replace(
        '#include <opaque_fragment>',
        `if (uLight2DOn > 0.5) {
    vec3 lit = vec3(uAmbient2D);
    for (int i = 0; i < ${MAX_LIGHTS_2D}; i++) {
      if (i >= uLight2DCount) break;
      vec3 p = uLight2DPos[i];
      float f = 1.0 - smoothstep(0.0, p.z, distance(vWorld2D, p.xy));
      lit += uLight2DColor[i] * f * f;
    }
    outgoingLight *= lit;
  }
  #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'light2d';
  return mat;
}
