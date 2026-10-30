import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { Light, Transform } from '../components/builtin';
import { DayNightCycle, Fog, Sky, sunFromHour } from '../components/environment';
import { RenderSystem } from './RenderSystem';
import { EnvironmentSystem } from './EnvironmentSystem';
import { defaultSceneSettings } from '../scene/SceneData';

function setup() {
  const scene = new THREE.Scene();
  const world = new World();
  const render = new RenderSystem(scene);
  world.addSystem(render);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(100, 2, 50);
  const settings = defaultSceneSettings();
  render.applySettings(settings);
  const env = new EnvironmentSystem(scene, render, { renderer: null, camera: () => camera, settings: () => settings });
  world.addSystem(env);
  const frame = (dt = 1 / 60) => world.update(dt);
  return { scene, world, env, frame, camera, render };
}

describe('sunFromHour', () => {
  it('is highest at noon, on the horizon at 6 and 18, below at night', () => {
    const base = { sunDirection: 0, sunHeight: 60 };
    expect(sunFromHour({ ...base, hour: 12 }).elevation).toBeCloseTo(60);
    expect(sunFromHour({ ...base, hour: 6 }).elevation).toBeCloseTo(0);
    expect(sunFromHour({ ...base, hour: 18 }).elevation).toBeCloseTo(0, 5);
    expect(sunFromHour({ ...base, hour: 0 }).elevation).toBeLessThan(0);
    const d = sunFromHour({ ...base, hour: 12 }).dir;
    expect(Math.hypot(...d)).toBeCloseTo(1);
  });
});

describe('EnvironmentSystem', () => {
  it('changes nothing when the scene has no environment components', () => {
    const { scene, frame } = setup();
    frame();
    expect(scene.getObjectByName('EGE:Sky')).toBeUndefined();
    expect(scene.fog).toBeNull(); // fog is off by default now
  });

  it('adds a sky only while a Sky component exists', () => {
    const { scene, world, frame } = setup();
    const e = world.createEntity();
    e.add(Sky, { hour: 9 });
    frame();
    expect(scene.getObjectByName('EGE:Sky')).toBeDefined();
    expect(scene.background).toBeNull();
    e.remove(Sky);
    frame();
    expect(scene.getObjectByName('EGE:Sky')).toBeUndefined();
    expect(scene.background).toBeInstanceOf(THREE.Color); // background color is back
  });

  it('fog appears only with a Fog component, and follows its settings', () => {
    const { scene, world, frame } = setup();
    const e = world.createEntity();
    e.add(Fog, { mode: 'distance', start: 10, end: 90, matchSky: false, color: '#ff0000', thinsOut: 0 });
    frame();
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect((scene.fog as THREE.Fog).far).toBe(90);
    // Height fog: from high above (camera well over the ground level) it reaches much further.
    e.set(Fog, { thinsOut: 40, groundLevel: -400 });
    frame();
    expect((scene.fog as THREE.Fog).far).toBeGreaterThan(90 * 9);
    e.set(Fog, { mode: 'exponential', density: 0.02 });
    frame();
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
    e.remove(Fog);
    frame();
    expect(scene.fog).toBeNull();
  });

  it('day/night cycle moves time only while playing (or previewing), never saving it', () => {
    const { world, env, frame } = setup();
    const e = world.createEntity();
    e.add(Sky, { hour: 12 });
    e.add(DayNightCycle, { minutesPerDay: 1 }); // 24 h per minute
    for (let i = 0; i < 60; i++) frame();
    expect(env.hour).toBe(12); // editing: frozen
    env.playing = true;
    for (let i = 0; i < 60; i++) frame(); // 1 s = 0.4 h
    expect(env.hour).toBeCloseTo(12.4, 1);
    expect(e.require(Sky).hour).toBe(12); // the saved hour is untouched
    env.resetTime();
    expect(env.hour).toBe(12);
  });

  it('drives the sun light: bright by day, faint moonlight at night', () => {
    const { world, frame, render } = setup();
    const sun = world.createEntity();
    sun.add(Transform);
    sun.add(Light, { kind: 'directional', intensity: 3 });
    const sky = world.createEntity();
    sky.add(Sky, { hour: 12, sunHeight: 70 });
    frame();
    const light = render.nodeOf(sun)!.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    expect(light.intensity).toBeCloseTo(3, 1);
    sky.set(Sky, { hour: 1 });
    frame();
    expect(light.intensity).toBeLessThan(0.3);
  });

  it('keeps sun shadows centred on the camera, not the world origin', () => {
    const { world, frame, render, camera } = setup();
    const sun = world.createEntity();
    sun.add(Transform, { rotation: [-50, 30, 0] });
    sun.add(Light, { kind: 'directional', castShadow: true });
    frame();
    const light = render.nodeOf(sun)!.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    light.target.updateWorldMatrix(true, false);
    const target = light.target.getWorldPosition(new THREE.Vector3());
    expect(target.distanceTo(new THREE.Vector3(camera.position.x, 0, camera.position.z))).toBeLessThan(40);
  });

  it('dims ambient light at night when the Sky controls lighting', () => {
    const { world, frame, render } = setup();
    const amb = world.createEntity();
    amb.add(Transform);
    amb.add(Light, { kind: 'hemisphere', intensity: 1 });
    const sky = world.createEntity();
    sky.add(Sky, { hour: 12 });
    frame();
    const light = render.nodeOf(amb)!.children.find((o) => (o as THREE.Light).isLight) as THREE.Light;
    expect(light.intensity).toBeCloseTo(1, 1);
    sky.set(Sky, { hour: 1 });
    frame();
    expect(light.intensity).toBeLessThan(0.2);
    sky.remove(Sky);
    frame();
    expect(light.intensity).toBeCloseTo(1, 1);
  });

  it('blends between times of day', async () => {
    const { skyTimesAt } = await import('../components/environment');
    expect([skyTimesAt(12).a, skyTimesAt(12).b]).toEqual(['day', 'day']);
    expect(skyTimesAt(2).a).toBe('night');
    const s = skyTimesAt(17);
    expect([s.a, s.b]).toEqual(['day', 'sunset']);
    expect(s.blend).toBeGreaterThan(0.3);
    expect(s.blend).toBeLessThan(0.7);
  });
});


describe('shadow stability', () => {
  it('moves the shadow box in whole shadow-map pixels only', async () => {
    const { snapToShadowTexels } = await import('./EnvironmentSystem');
    const toLight = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    const texel = 90 / 2048;
    // What shimmers is movement across the light's view (depth along the light doesn't matter).
    const across = (v: THREE.Vector3) => v.clone().sub(toLight.clone().multiplyScalar(v.dot(toLight)));
    const a = snapToShadowTexels(new THREE.Vector3(10, 0, 5), toLight, texel);
    const b = snapToShadowTexels(new THREE.Vector3(10.002, 0, 5.001), toLight, texel); // a tiny step
    expect(across(b.clone().sub(a)).length()).toBeLessThan(1e-6);
    // A bigger step moves it by whole pixels.
    const c = snapToShadowTexels(new THREE.Vector3(13.37, 0, 2.41), toLight, texel);
    const helper = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(helper, toLight).normalize();
    const up = new THREE.Vector3().crossVectors(toLight, right);
    for (const axis of [right, up]) {
      const pixels = c.clone().sub(a).dot(axis) / texel;
      expect(Math.abs(pixels - Math.round(pixels))).toBeLessThan(1e-3);
    }
  });
});
