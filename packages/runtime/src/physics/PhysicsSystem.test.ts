import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { Transform, MeshRenderer } from '../components/builtin';
import { CharacterController, Climbable, Collider, RigidBody, Water } from '../components/physics';
import { PhysicsSystem } from './PhysicsSystem';
import { RenderSystem } from '../render/RenderSystem';
import { Input } from '../input/Input';
import { loadPhysics } from '../core/loadPhysics';
import type { Vec3 } from '../core/Component';

const DT = 1 / 60;

async function setup() {
  const rapier = await loadPhysics();
  const world = new World();
  const render = new RenderSystem(new THREE.Scene());
  world.addSystem(render);
  const keys = new EventTarget();
  const input = new Input(keys);
  // Camera looking down -Z, so "W" walks toward -Z.
  const camera = new THREE.PerspectiveCamera();
  const physics = new PhysicsSystem(rapier, render, { input, camera: () => camera });
  world.addSystem(physics);
  const press = (code: string) => keys.dispatchEvent(Object.assign(new Event('keydown'), { code }));
  const release = (code: string) => keys.dispatchEvent(Object.assign(new Event('keyup'), { code }));
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      world.fixedUpdate(DT);
      world.update(DT);
      input.endFrame();
    }
  };
  const box = (name: string, position: Vec3, scale: Vec3, extra?: (e: ReturnType<World['createEntity']>) => void) => {
    const e = world.createEntity({ name });
    e.add(Transform, { position, scale });
    e.add(MeshRenderer, { shape: 'box' });
    e.add(Collider);
    extra?.(e);
    return e;
  };
  const ground = () => box('Ground', [0, -0.5, 0], [40, 1, 40]);
  return { world, physics, input, press, release, run, box, ground };
}

const pos = (e: { require: (d: typeof Transform) => { position: Vec3 } }) => e.require(Transform).position;

describe('PhysicsSystem', () => {
  it('a dynamic box falls and comes to rest on the ground', async () => {
    const { physics, run, box, ground } = await setup();
    ground();
    const crate = box('Crate', [0, 5, 0], [1, 1, 1], (e) => e.add(RigidBody));
    physics.setSimulating(true);
    run(3);
    expect(pos(crate)[1]).toBeCloseTo(0.5, 1);
  });

  it('nothing moves in edit mode, and colliders follow edited transforms', async () => {
    const { physics, run, box, ground } = await setup();
    ground();
    const crate = box('Crate', [0, 5, 0], [1, 1, 1], (e) => e.add(RigidBody));
    run(1);
    expect(pos(crate)[1]).toBe(5);
    crate.set(Transform, { position: [3, 2, 0] });
    run(DT);
    physics.setSimulating(true); // starts from the edited pose
    run(2);
    expect(pos(crate)[0]).toBeCloseTo(3, 2);
    expect(pos(crate)[1]).toBeCloseTo(0.5, 1);
  });

  it('auto colliders match the visible shape and scale', async () => {
    const { world, physics, run, ground } = await setup();
    ground();
    const ball = world.createEntity();
    ball.add(Transform, { position: [0, 4, 0], scale: [2, 2, 2] });
    ball.add(MeshRenderer, { shape: 'sphere' });
    ball.add(RigidBody); // no Collider component: gets an automatic one
    physics.setSimulating(true);
    run(3);
    expect(pos(ball)[1]).toBeCloseTo(1, 1); // radius 0.5 × scale 2
  });

  it('triggers report enter and exit without blocking', async () => {
    const { world, physics, run, box } = await setup();
    box('Zone', [0, 0, 0], [4, 1, 4], (e) => e.set(Collider, { isTrigger: true }));
    const ball = world.createEntity({ name: 'Ball' });
    ball.add(Transform, { position: [0, 3, 0], scale: [0.5, 0.5, 0.5] });
    ball.add(MeshRenderer, { shape: 'sphere' });
    ball.add(RigidBody);
    const log: string[] = [];
    physics.events.on('triggerEnter', ({ trigger, other }) => log.push(`enter ${trigger.name}<-${other.name}`));
    physics.events.on('triggerExit', ({ trigger, other }) => log.push(`exit ${trigger.name}<-${other.name}`));
    physics.setSimulating(true);
    run(2);
    expect(log).toEqual(['enter Zone<-Ball', 'exit Zone<-Ball']);
    expect(pos(ball)[1]).toBeLessThan(-1); // fell straight through
  });

  it('mesh colliders use the real triangles of what you see', async () => {
    const { world, physics, run, box } = await setup();
    // A torus lying flat: a ball dropped through its hole falls through, one dropped on the ring lands.
    const ring = world.createEntity({ name: 'Ring' });
    ring.add(Transform, { position: [0, 1, 0], rotation: [90, 0, 0], scale: [4, 4, 4] });
    ring.add(MeshRenderer, { shape: 'torus' });
    ring.add(Collider); // auto → exact mesh for a static torus
    box('Floor', [0, -0.5, 0], [40, 1, 40]);
    const throughHole = box('Hole', [0, 4, 0], [0.4, 0.4, 0.4], (e) => e.add(RigidBody));
    const onRing = box('Ring hit', [1.6, 4, 0], [0.4, 0.4, 0.4], (e) => e.add(RigidBody));
    physics.setSimulating(true);
    run(3);
    expect(pos(throughHole)[1]).toBeLessThan(0.5); // fell to the floor
    expect(pos(onRing)[1]).toBeGreaterThan(1); // resting on the ring
  });

  it('collision events fire between solid bodies', async () => {
    const { physics, run, box, ground } = await setup();
    ground();
    box('Crate', [0, 2, 0], [1, 1, 1], (e) => e.add(RigidBody));
    const hits: string[] = [];
    physics.events.on('collisionEnter', ({ a, b }) => hits.push([a.name, b.name].sort().join('+')));
    physics.setSimulating(true);
    run(1.5);
    expect(hits).toContain('Crate+Ground');
  });

  describe('CharacterController', () => {
    async function character() {
      const t = await setup();
      t.ground();
      const hero = t.world.createEntity({ name: 'Hero' });
      hero.add(Transform, { position: [0, 0, 0] });
      hero.add(CharacterController);
      t.physics.setSimulating(true);
      t.run(0.5); // settle onto the ground
      return { ...t, hero };
    }

    it('stands on the ground and walks where the camera faces', async () => {
      const { hero, physics, run, press, release } = await character();
      expect(physics.isGrounded(hero)).toBe(true);
      expect(pos(hero)[1]).toBeCloseTo(0, 1);
      press('KeyW');
      run(1);
      release('KeyW');
      expect(pos(hero)[2]).toBeLessThan(-3); // ~4 m/s toward -Z
      expect(pos(hero)[2]).toBeGreaterThan(-5);
      // Turned to face the walking direction (yaw ≈ 180°).
      expect(Math.abs(hero.require(Transform).rotation[1])).toBeGreaterThan(150);
    });

    it('runs faster with Shift', async () => {
      const { hero, run, press } = await character();
      press('KeyW');
      press('ShiftLeft');
      run(1);
      expect(pos(hero)[2]).toBeLessThan(-6.5);
    });

    it('is stopped by walls', async () => {
      const { hero, run, press, box } = await character();
      box('Wall', [0, 1, -2], [6, 2, 0.5]);
      press('KeyW');
      run(2);
      expect(pos(hero)[2]).toBeGreaterThan(-1.8); // wall face at z = -1.75
    });

    it('walks up a small step but not a tall one', async () => {
      const { hero, run, press, box } = await character();
      box('Step', [0, 0.1, -4], [4, 0.2, 4]); // spans z -2 … -6
      box('Tall', [0, 1, -8], [4, 2, 2]);
      press('KeyW');
      run(1); // ~4 m: on the step
      expect(pos(hero)[1]).toBeGreaterThan(0.15); // on the 0.2 m step
      run(2);
      expect(pos(hero)[2]).toBeGreaterThan(-7.1); // blocked by the 2 m block
    });

    it('falls off ledges and lands', async () => {
      const { hero, physics, run, press, box, world } = await character();
      world.destroyEntity(world.findByName('Ground')!);
      box('Platform', [0, 2.5, 0], [3, 1, 3]);
      box('Floor', [0, -0.5, 0], [40, 1, 40]);
      hero.set(Transform, { position: [0, 3, 0] });
      run(0.5);
      expect(pos(hero)[1]).toBeCloseTo(3, 1);
      press('KeyW');
      run(1.5);
      expect(pos(hero)[1]).toBeCloseTo(0, 1);
      expect(physics.isGrounded(hero)).toBe(true);
    });

    it('jumps when Space is pressed on the ground', async () => {
      const { hero, input, run, press, release } = await character();
      press('Space');
      // The system reads the press during update(); then fixed steps apply it.
      let peak = 0;
      for (let i = 0; i < 60; i++) {
        run(DT);
        peak = Math.max(peak, pos(hero)[1]);
        if (i === 0) release('Space');
      }
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThan(1.4);
      run(1);
      expect(pos(hero)[1]).toBeCloseTo(0, 1);
      void input;
    });

    it('bounces back up after landing on something Bouncy', async () => {
      const { hero, run, world } = await character();
      world.findByName('Ground')!.set(Collider, { bounciness: 0.9 });
      hero.set(Transform, { position: [0, 4, 0] });
      run(0.85); // falls about 4 m, lands
      let peak = 0;
      for (let i = 0; i < 90; i++) {
        run(DT);
        peak = Math.max(peak, pos(hero)[1]);
      }
      expect(peak).toBeGreaterThan(2);
    });

    it('slides on a Slippery floor instead of stopping at once', async () => {
      const ice = await character();
      ice.world.findByName('Ground')!.set(Collider, { friction: 0 });
      const plain = await character();
      for (const t of [ice, plain]) {
        t.press('KeyW');
        t.run(1);
        t.release('KeyW');
      }
      const z = (t: typeof ice) => pos(t.hero)[2];
      // Slow to speed up on ice…
      expect(z(ice)).toBeGreaterThan(z(plain) + 0.5);
      const iceAt = z(ice);
      const plainAt = z(plain);
      ice.run(1);
      plain.run(1);
      // …and keeps sliding after letting go.
      expect(iceAt - z(ice)).toBeGreaterThan(0.5);
      expect(Math.abs(plainAt - z(plain))).toBeLessThan(0.05);
    });
  });

  describe('climbing, swimming, AI and carrying', () => {
    it('climbs a ladder with W and gets onto the platform at the top', async () => {
      const { world, physics, run, press, release, box, ground } = await setup();
      ground();
      // A 3 m tall wall-ladder in front of the hero, with a platform on top behind it.
      box('Ladder', [0, 1.5, -1.2], [2, 3, 0.2], (e) => e.add(Climbable));
      box('Platform', [0, 2.75, -3], [4, 0.5, 3.4]);
      const hero = world.createEntity({ name: 'Hero' });
      hero.add(Transform, { position: [0, 0, 0] });
      hero.add(CharacterController);
      physics.setSimulating(true);
      run(0.3);
      press('KeyW');
      let climbed = false;
      // Hold W until we're up and over the top, then a moment more to step onto the platform.
      for (let i = 0; i < 300; i++) {
        run(DT);
        if (physics.isClimbing(hero)) climbed = true;
        else if (climbed) break;
      }
      run(0.2);
      release('KeyW');
      run(0.8);
      expect(climbed).toBe(true);
      expect(physics.isClimbing(hero)).toBe(false);
      expect(pos(hero)[1]).toBeGreaterThan(2.9); // standing on the 3 m platform
      expect(physics.isGrounded(hero)).toBe(true);
    });

    it('also works for characters whose origin is the middle of the capsule', async () => {
      const { world, physics, run, press, release, box, ground } = await setup();
      ground();
      box('Ladder', [0, 2, -1.3], [1.1, 4, 0.12], (e) => e.add(Climbable));
      box('Deck', [0, 4.1, -2.9], [3, 0.3, 3]);
      const hero = world.createEntity({ name: 'Hero' });
      hero.add(Transform, { position: [0, 1, 0] }); // capsule centre at 1 m: feet on the ground
      hero.add(CharacterController, { center: [0, 0, 0], height: 2, radius: 0.5 });
      physics.setSimulating(true);
      run(0.3);
      press('KeyW');
      let climbed = false;
      for (let i = 0; i < 360; i++) {
        run(DT);
        if (physics.isClimbing(hero)) climbed = true;
        else if (climbed) break;
      }
      run(0.25);
      release('KeyW');
      run(0.8);
      expect(climbed).toBe(true);
      expect(pos(hero)[1]).toBeGreaterThan(5.1); // centre 1 m above the 4.25 m deck
      expect(physics.isGrounded(hero)).toBe(true);
    });

    it('moving platforms carry the character standing on them', async () => {
      const { world, physics, run, box, ground } = await setup();
      ground();
      const lift = box('Platform', [0, 0.25, 0], [3, 0.5, 3]);
      const hero = world.createEntity({ name: 'Hero' });
      hero.add(Transform, { position: [0, 0.5, 0] });
      hero.add(CharacterController);
      physics.setSimulating(true);
      run(0.3);
      for (let i = 0; i < 60; i++) {
        lift.require(Transform).position[0] += 2 / 60; // 2 m/s along X (like a script move)
        world.fixedUpdate(DT);
        world.update(DT);
      }
      expect(pos(hero)[0]).toBeGreaterThan(1.7); // rode ~2 m with it
      expect(pos(hero)[1]).toBeCloseTo(0.5, 1); // still standing on top
    });

    it('spinning platforms carry the character around', async () => {
      const { world, physics, run, box, ground } = await setup();
      ground();
      const disc = box('Spinner', [0, 0.25, 0], [6, 0.5, 6]);
      const hero = world.createEntity({ name: 'Hero' });
      hero.add(Transform, { position: [2, 0.5, 0] });
      hero.add(CharacterController);
      physics.setSimulating(true);
      run(0.3);
      for (let i = 0; i < 60; i++) {
        disc.require(Transform).rotation[1] += 90 / 60; // a quarter turn in one second
        world.fixedUpdate(DT);
        world.update(DT);
      }
      const p = pos(hero);
      expect(Math.hypot(p[0], p[2])).toBeCloseTo(2, 0); // same distance from the centre
      expect(Math.abs(p[2])).toBeGreaterThan(1.5); // moved round toward the Z axis
    });

    it('jumping off a ladder lets go', async () => {
      const { world, physics, run, press, release, box, ground } = await setup();
      ground();
      box('Ladder', [0, 3, -1.2], [2, 6, 0.2], (e) => e.add(Climbable));
      const hero = world.createEntity({ name: 'Hero' });
      hero.add(Transform, { position: [0, 0, 0] });
      hero.add(CharacterController);
      physics.setSimulating(true);
      press('KeyW');
      run(1.2);
      expect(physics.isClimbing(hero)).toBe(true);
      const h = pos(hero)[1];
      expect(h).toBeGreaterThan(1);
      release('KeyW');
      run(0.5);
      expect(pos(hero)[1]).toBeCloseTo(h, 1); // hangs on, no gravity
      press('Space');
      world.update(DT); // the jump press is read in update
      release('Space');
      run(1.5);
      expect(physics.isClimbing(hero)).toBe(false);
      expect(pos(hero)[1]).toBeLessThan(0.2); // fell back down
    });

    it('floats in water with its head above the surface, and swims slower', async () => {
      const { world, physics, run, press, box } = await setup();
      box('Floor', [0, -3.5, 0], [40, 1, 40]); // lake bottom at y = -3
      box('Lake', [0, -1.5, -6], [20, 3, 20], (e) => {
        e.set(Collider, { isTrigger: true });
        e.add(Water);
      }); // surface at y = 0
      const hero = world.createEntity({ name: 'Hero' });
      hero.add(Transform, { position: [0, 2, -6] });
      hero.add(CharacterController);
      physics.setSimulating(true);
      run(3);
      expect(physics.isSwimming(hero)).toBe(true);
      const y = pos(hero)[1];
      expect(y).toBeGreaterThan(-1.4); // not sunk to the bottom (-3)
      expect(y).toBeLessThan(-0.8); // chest-deep: feet ~1.1 m under the surface
      const z0 = pos(hero)[2];
      press('KeyW');
      run(1);
      const swum = z0 - pos(hero)[2];
      expect(swum).toBeGreaterThan(1.5);
      expect(swum).toBeLessThan(3); // slower than walking (4 m/s)
    });

    it('AI characters walk where their intent points, with collisions', async () => {
      const { world, physics, run, ground, box } = await setup();
      ground();
      box('Wall', [5, 1, 0], [0.5, 2, 6]);
      const bot = world.createEntity({ name: 'Bot' });
      bot.add(Transform, { position: [0, 0, 0] });
      bot.add(CharacterController, { playerControlled: false, speed: 3 });
      physics.setSimulating(true);
      for (let i = 0; i < 180; i++) {
        physics.setMoveIntent(bot, new THREE.Vector3(1, 0, 0));
        run(DT);
      }
      expect(pos(bot)[0]).toBeGreaterThan(4); // walked ~3 m/s
      expect(pos(bot)[0]).toBeLessThan(4.5); // stopped by the wall at x = 4.75
      run(0.5); // intent expired: stands still
      const x = pos(bot)[0];
      run(0.5);
      expect(pos(bot)[0]).toBeCloseTo(x, 3);
    });

    it('held bodies stop falling and follow their transform; released they fall', async () => {
      const { world, physics, run, ground, box } = await setup();
      ground();
      const crate = box('Crate', [0, 3, 0], [1, 1, 1], (e) => e.add(RigidBody));
      physics.setSimulating(true);
      run(DT);
      physics.setHeld(crate, true);
      crate.set(Transform, { position: [2, 3, 0] });
      run(1);
      expect(pos(crate)).toEqual([2, 3, 0]);
      physics.setHeld(crate, false);
      run(2);
      expect(pos(crate)[1]).toBeCloseTo(0.5, 1);
      void world;
    });

    it('raycasts hit the first solid thing and can skip one entity', async () => {
      const { world, physics, box } = await setup();
      const near = box('Near', [0, 0, -3], [1, 1, 1]);
      box('Far', [0, 0, -8], [1, 1, 1]);
      box('Ghost', [0, 0, -1.5], [1, 1, 1], (e) => e.set(Collider, { isTrigger: true }));
      const o = new THREE.Vector3(0, 0, 0);
      const d = new THREE.Vector3(0, 0, -1);
      expect(physics.raycast(o, d, 20)?.entity).toBe(near); // trigger ignored
      expect(physics.raycast(o, d, 20)?.distance).toBeCloseTo(2.5, 2);
      expect(physics.raycast(o, d, 20, near)?.entity?.name).toBe('Far');
      expect(physics.raycast(o, d, 1)).toBeNull();
      void world;
    });
  });

  it('writes local transforms for children of rotated parents', async () => {
    const { world, physics, run, ground } = await setup();
    ground();
    const parent = world.createEntity({ name: 'Parent' });
    parent.add(Transform, { position: [2, 0, 0], rotation: [0, 90, 0] });
    const crate = world.createEntity({ name: 'Crate', parent });
    crate.add(Transform, { position: [0, 3, 0] });
    crate.add(MeshRenderer);
    crate.add(RigidBody);
    physics.setSimulating(true);
    run(2);
    const p = pos(crate);
    expect(p[0]).toBeCloseTo(0, 1);
    expect(p[1]).toBeCloseTo(0.5, 1);
  });

  it('rebuilds when components change and cleans up destroyed entities', async () => {
    const { world, physics, run, box } = await setup();
    const a = box('A', [0, 0, 0], [1, 1, 1]);
    run(DT);
    expect(physics.bodyCount).toBe(1);
    a.remove(Collider);
    run(DT);
    expect(physics.bodyCount).toBe(0);
    a.add(RigidBody);
    run(DT);
    expect(physics.bodyCount).toBe(1);
    world.destroyEntity(a);
    expect(physics.bodyCount).toBe(0);
  });
});
