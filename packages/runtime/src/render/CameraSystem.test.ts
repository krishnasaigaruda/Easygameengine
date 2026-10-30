import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { Camera, MeshRenderer, Transform } from '../components/builtin';
import { Collider } from '../components/physics';
import { FollowCamera } from '../components/camera';
import { CameraSystem } from './CameraSystem';
import { RenderSystem } from './RenderSystem';
import { PhysicsSystem } from '../physics/PhysicsSystem';
import { Input } from '../input/Input';
import { loadPhysics } from '../core/loadPhysics';
import type { Vec3 } from '../core/Component';

async function setup(locked = false) {
  const world = new World();
  const render = new RenderSystem(new THREE.Scene());
  world.addSystem(render);
  const physics = new PhysicsSystem(await loadPhysics(), render);
  world.addSystem(physics);
  const keys = new EventTarget();
  const input = new Input(keys);
  const cams = new CameraSystem({ input, physics, pointerLocked: () => locked });
  world.addSystem(cams);
  const player = world.createEntity({ name: 'Hero' });
  player.tags.add('player');
  player.add(Transform, { position: [0, 0, 0] });
  const cam = world.createEntity({ name: 'Cam' });
  cam.add(Transform, { position: [0, 2, 5] });
  cam.add(Camera);
  cam.add(FollowCamera, { distance: 4, height: 1.5, shoulder: 0, pitch: 20, smoothing: 1000 });
  physics.setSimulating(true);
  cams.setRunning(true);
  const frame = () => {
    world.fixedUpdate(1 / 60);
    world.update(1 / 60);
    input.endFrame();
  };
  const move = (dx: number, dy: number) =>
    keys.dispatchEvent(Object.assign(new Event('pointermove'), { movementX: dx, movementY: dy, clientX: 0, clientY: 0 }));
  return { world, cams, cam, player, frame, move, render };
}

const pos = (e: { require: (d: typeof Transform) => { position: Vec3 } }) => new THREE.Vector3(...e.require(Transform).position);

describe('CameraSystem', () => {
  it('sits behind and above the target and keeps following it', async () => {
    const { cam, player, frame } = await setup();
    frame();
    const p = pos(cam);
    const pivot = new THREE.Vector3(0, 1.5, 0);
    expect(p.distanceTo(pivot)).toBeCloseTo(4, 2);
    expect(p.z).toBeGreaterThan(3); // behind (camera started looking down -Z)
    expect(p.y).toBeGreaterThan(pivot.y); // tilted down at 20°
    player.require(Transform).position = [10, 0, -3];
    frame();
    expect(pos(cam).distanceTo(new THREE.Vector3(10, 1.5, -3))).toBeCloseTo(4, 2);
  });

  it('looks at the target', async () => {
    const { cam, frame, render } = await setup();
    frame();
    render.lateUpdate();
    const node = render.nodeOf(cam)!;
    node.updateWorldMatrix(true, false);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()));
    const toTarget = new THREE.Vector3(0, 1.5, 0).sub(node.getWorldPosition(new THREE.Vector3())).normalize();
    expect(dir.dot(toTarget)).toBeGreaterThan(0.999);
  });

  it('mouse turns the camera only while the mouse is captured', async () => {
    const free = await setup(false);
    free.frame();
    free.move(100, 0);
    free.frame();
    expect(free.cams.orbitOf(free.cam)!.yaw).toBeCloseTo(0, 3);

    const locked = await setup(true);
    locked.frame();
    locked.move(100, 50);
    locked.frame();
    const o = locked.cams.orbitOf(locked.cam)!;
    expect(o.yaw).toBeCloseTo(-18, 1); // 100 px × 0.18°
    expect(o.pitch).toBeCloseTo(29, 1); // 20° + 50 px × 0.18°
  });

  it('pitch stays within limits', async () => {
    const { cams, cam, frame, move } = await setup(true);
    frame();
    move(0, 5000);
    frame();
    expect(cams.orbitOf(cam)!.pitch).toBeCloseTo(70, 3);
  });

  it('moves in front of walls instead of going through them', async () => {
    const { world, cam, frame } = await setup();
    const wall = world.createEntity({ name: 'Wall' });
    wall.add(Transform, { position: [0, 2, 2], scale: [6, 6, 0.3] });
    wall.add(MeshRenderer);
    wall.add(Collider);
    frame();
    frame();
    const d = pos(cam).distanceTo(new THREE.Vector3(0, 1.5, 0));
    expect(d).toBeLessThan(2.2); // pulled in from 4 m to just in front of the wall
    expect(pos(cam).z).toBeLessThan(1.85);
  });

  it('first-person: the camera sits at the eyes', async () => {
    const { cam, frame } = await setup();
    cam.set(FollowCamera, { mode: 'first-person', height: 1.7 });
    frame();
    expect(pos(cam).distanceTo(new THREE.Vector3(0, 1.7, 0))).toBeLessThan(1e-3);
  });

  it('top-down: high above the target, looking down', async () => {
    const { cam, frame } = await setup();
    cam.set(FollowCamera, { mode: 'top-down', distance: 12, pitch: 65, height: 0 });
    frame();
    expect(pos(cam).y).toBeGreaterThan(10);
  });

  it('look-around: never moves from its spot and stays within its turn range', async () => {
    const { cam, cams, frame, move } = await setup(true);
    cam.set(FollowCamera, { mode: 'look-around', edgePan: false, yawRange: 30 });
    cam.set(Transform, { position: [3, 2, 7], rotation: [0, 0, 0] });
    frame();
    move(5000, 0); // try to spin far past the limit
    frame();
    expect(pos(cam).toArray()).toEqual([3, 2, 7]);
    expect(Math.abs(cams.orbitOf(cam)!.yaw)).toBeCloseTo(30, 1);
  });
});

