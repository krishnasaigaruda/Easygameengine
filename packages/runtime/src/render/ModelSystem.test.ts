import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ModelSystem, boneKey, findClip, inPlaceClip, retargetClips } from './ModelSystem';
import { applyClipEvents, eventsCrossed } from './clipEvents';
import { RenderSystem } from './RenderSystem';
import { World } from '../core/World';
import { Animator, ModelRenderer, Transform } from '../components/builtin';
import { AssetManager } from '../assets/AssetManager';

const clip = (name: string, tracks: THREE.KeyframeTrack[] = []) => new THREE.AnimationClip(name, 1, tracks);

describe('Animator clip choice', () => {
  const clips = ['Rig|walk_left', 'Rig|Walk', 'Rig|idle_pistol', 'Rig|Idle', 'Rig|run', 'Rig|jumping', 'Rig|air'].map((n) => clip(n));

  it('finds plain idle / walk / run before their variants', () => {
    expect(findClip(clips, ['idle'])).toBe('Rig|Idle');
    expect(findClip(clips, ['walk'])).toBe('Rig|Walk');
    expect(findClip(clips, ['run', 'jog'])).toBe('Rig|run');
    expect(findClip(clips, ['air', 'fall', 'jump'])).toBe('Rig|air');
    expect(findClip(clips, ['swim'])).toBe('');
  });

  it('walks on the spot: forward drift removed, sway kept', () => {
    // Hips move 2 m forward over the clip while swaying 0.1 m sideways.
    const hips = new THREE.VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0, 1, 0, 0.1, 1.05, 1, 0, 1, 2]);
    const fixed = inPlaceClip(clip('walk', [hips]));
    const v = fixed.tracks[0].values;
    expect([v[0], v[2], v[6], v[8]]).toEqual([0, 0, 0, 0]);
    expect(v[3]).toBeCloseTo(0.1); // sway stays
    expect(v[4]).toBeCloseTo(1.05); // bob stays
    expect(hips.values[8]).toBe(2); // the original clip is untouched
  });
});

describe('Animator', () => {
  function setup(names = ['Idle', 'Walk', 'Run', 'Punch', 'Death']) {
    const world = new World();
    const render = new RenderSystem(new THREE.Scene());
    world.addSystem(render);
    const models = new ModelSystem(render, new AssetManager());
    world.addSystem(models);
    const hero = world.createEntity({ name: 'Hero' });
    hero.add(Transform);
    hero.add(Animator);
    const body = world.createEntity({ name: 'Body', parent: hero });
    body.add(Transform);
    body.add(ModelRenderer, { model: '' });
    world.update(0);
    // Stand in for a loaded rigged model (loading is tested elsewhere).
    const object = new THREE.Object3D();
    render.nodeOf(body)!.add(object);
    const track = () => [new THREE.NumberKeyframeTrack('.visible', [0, 1], [1, 1])];
    const clips = names.map((n) => new THREE.AnimationClip(n, 1, track()));
    const state = { assetId: 'x', token: 1, object, clips, mixer: new THREE.AnimationMixer(object), bounds: new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 2, 0.5)), baseScale: new THREE.Vector3(1, 1, 1), basePosition: new THREE.Vector3(), baseQuaternion: new THREE.Quaternion(), data: body.get(ModelRenderer)! };
    (models as unknown as { states: Map<string, unknown> }).states.set(body.id, state);
    const run = (speedX: number, seconds: number, speedY = 0) => {
      for (let i = 0; i < seconds * 60; i++) {
        const p = hero.get(Transform)!.position;
        hero.set(Transform, { position: [p[0] + speedX / 60, p[1] + speedY / 60, 0] });
        world.update(1 / 60);
      }
    };
    const clip = () => (state as { clipName?: string }).clipName;
    const rate = () => (state as { action?: THREE.AnimationAction }).action?.timeScale;
    return { models, hero, object, run, clip, rate };
  }

  it('stands, walks and runs from how fast the object moves, and faces where it goes', () => {
    const { run, clip, object } = setup();
    run(0, 0.5);
    expect(clip()).toBe('Idle');
    run(1.5, 1);
    expect(clip()).toBe('Walk');
    // Walking toward +X: the model turns to face it (models face +Z, so a quarter turn).
    expect(new THREE.Euler().setFromQuaternion(object.quaternion, 'YXZ').y).toBeCloseTo(Math.PI / 2, 1);
    run(5, 1);
    expect(clip()).toBe('Run');
    run(0, 1);
    expect(clip()).toBe('Idle');
  });

  it('swims and climbs with sample clips found by name, and climbs backwards going down', () => {
    const { models, run, clip, rate } = setup(['Idle_A', 'Walk', 'Swim_Fwd', 'Swim_Idle', 'Climb Ladder', 'ClimbUp_1m_RM', 'Ladder_Idle']);
    let mode: 'walk' | 'swim' | 'climb' = 'walk';
    models.moveMode = () => mode;
    run(0, 0.5);
    expect(clip()).toBe('Idle_A'); // not Swim_Idle / Ladder_Idle
    mode = 'swim';
    run(0, 0.5);
    expect(clip()).toBe('Swim_Idle');
    run(1.5, 1);
    expect(clip()).toBe('Swim_Fwd');
    mode = 'climb';
    run(0, 1, 1.2);
    expect(clip()).toBe('Climb Ladder');
    expect(rate()).toBeGreaterThan(0.5);
    run(0, 1, -1.2);
    expect(rate()).toBeLessThan(-0.5); // going down: backwards
    run(0, 1);
    expect(clip()).toBe('Ladder_Idle');
  });

  it('code points: the object gets a message each time the animation passes one', () => {
    const { models, run, hero } = setup(['Idle', 'Walk']);
    const walk = (models as unknown as { states: Map<string, { clips: THREE.AnimationClip[] }> }).states.values().next().value!.clips[1];
    applyClipEvents([walk], { clipEvents: { Walk: [{ time: 0.25, message: 'leftStep' }, { time: 0.75, message: 'rightStep' }] } });
    const got: string[] = [];
    models.onClipEvent = (e, m) => got.push(`${e.parent?.name ?? e.name}:${m}`);
    run(1.5, 2.1); // the 1 s walk clip loops about twice (played at its own speed)
    expect(got.filter((m) => m === 'Hero:leftStep').length).toBeGreaterThanOrEqual(2);
    expect(got.filter((m) => m === 'Hero:rightStep').length).toBeGreaterThanOrEqual(2);
    expect(hero.name).toBe('Hero');
  });

  it('on a slope, lowers the body until the lower foot touches the ground', () => {
    const { models, object, run } = setup();
    for (const [name, x] of [['mixamorig:LeftFoot', -0.2], ['mixamorig:RightFoot', 0.2]] as const) {
      const foot = new THREE.Bone();
      foot.name = name;
      foot.position.set(x, 0.05, 0);
      object.add(foot);
    }
    // Ground 0 under the left foot, 0.3 lower under the right one.
    models.groundAt = (x) => (x < 0 ? 0 : -0.3);
    run(0, 1);
    expect(object.position.y).toBeCloseTo(-0.3, 2);
    models.groundAt = () => 0; // flat again: back up
    run(0, 1);
    expect(object.position.y).toBeCloseTo(0, 2);
  });

  it('plays attack once and goes back to moving; defeated stays down', () => {
    const { models, hero, run, clip } = setup();
    run(0, 0.3);
    expect(models.playOnce(hero, 'attack')).toBe(true); // found by name: "Punch"
    run(0, 0.5);
    expect(clip()).toBe('Punch');
    run(0, 1);
    expect(clip()).toBe('Idle');
    expect(models.playOnce(hero, 'die')).toBe(true);
    run(2, 1);
    expect(clip()).toBe('Death');
    expect(models.playOnce(hero, 'dance')).toBe(false);
  });
});

describe('borrowed animations', () => {
  it('matches bones across naming styles', () => {
    for (const [a, b] of [
      ['mixamorig:LeftUpLeg', 'upper_leg_L_Rig'],
      ['mixamorig:LeftUpLeg', 'DEF-thigh.L'],
      ['mixamorig:RightForeArm', 'lower_arm_R_Rig'],
      ['mixamorig:Hips', 'hips_Rig'],
      ['mixamorig:Spine1', 'spine.001'],
    ]) expect(boneKey(a)).toBe(boneKey(b));
    expect(boneKey('mixamorig:Spine1')).not.toBe(boneKey('mixamorig:Spine2'));
    expect(boneKey('mixamorig:LeftUpLeg')).not.toBe(boneKey('mixamorig:RightUpLeg'));
  });

  it('moves a clip onto another skeleton by bone meaning', () => {
    const rig = new THREE.Group();
    const hips = new THREE.Bone();
    hips.name = 'hips_Rig';
    hips.position.y = 0.9;
    const thigh = new THREE.Bone();
    thigh.name = 'upper_leg_L_Rig';
    hips.add(thigh);
    rig.add(hips);
    const walk = new THREE.AnimationClip('Walk', 1, [
      new THREE.QuaternionKeyframeTrack('mixamorig:LeftUpLeg.quaternion', [0, 1], [0, 0, 0, 1, 0.38, 0, 0, 0.92]),
      new THREE.VectorKeyframeTrack('mixamorig:Hips.position', [0, 1], [0, 90, 0, 0, 95, 0]),
      new THREE.QuaternionKeyframeTrack('mixamorig:Tail.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const [out] = retargetClips([walk], rig);
    expect(out.tracks.map((t) => t.name).sort()).toEqual(['hips_Rig.position', 'upper_leg_L_Rig.quaternion']);
    // Hips movement scaled from centimeters (90) to this rig's 0.9 m.
    const hipsTrack = out.tracks.find((t) => t.name === 'hips_Rig.position')!;
    expect(hipsTrack.values[1]).toBeCloseTo(0.9);
    expect(hipsTrack.values[4]).toBeCloseTo(0.95);
  });
});


describe('code points', () => {
  const ev = [{ time: 0.2, message: 'a' }, { time: 0.8, message: 'b' }];
  it('finds the ones passed, wrapping around loops and going backwards', () => {
    expect(eventsCrossed(ev, 0.1, 0.5).map((e) => e.message)).toEqual(['a']);
    expect(eventsCrossed(ev, 0.7, 0.1).map((e) => e.message)).toEqual(['b']); // looped: 0.7 → end → 0.1
    expect(eventsCrossed(ev, 0.9, 0.5, true).map((e) => e.message)).toEqual(['b']);
    expect(eventsCrossed(ev, 0.3, 0.3)).toEqual([]);
  });
});
