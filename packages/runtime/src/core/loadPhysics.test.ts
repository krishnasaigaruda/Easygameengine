import { describe, expect, it } from 'vitest';
import { loadPhysics } from './loadPhysics';

describe('loadPhysics', () => {
  it('shares one init across concurrent callers', async () => {
    const a = loadPhysics();
    const b = loadPhysics();
    expect(a).toBe(b);
    const rapier = await a;
    // A world created now must stay valid after another caller "loads" again.
    const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 4, 0));
    world.createCollider(rapier.ColliderDesc.ball(0.5), body); // gives the body mass
    await loadPhysics();
    world.step();
    expect(body.translation().y).toBeLessThan(4);
    world.free();
  });
});
