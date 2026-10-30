import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { Light, MeshRenderer, Transform } from '../components/builtin';
import { CharacterController, Collider, RigidBody } from '../components/physics';
import { Script, Traits } from '../components/scripting';
import { UIPanel, UIText } from '../components/ui';
import { Sprite } from '../components/sprite';

import { RenderSystem } from '../render/RenderSystem';
import { PhysicsSystem } from '../physics/PhysicsSystem';
import { ScriptSystem, type ScriptLog } from './ScriptSystem';
import { AssetManager } from '../assets/AssetManager';
import { Input } from '../input/Input';
import { loadPhysics } from '../core/loadPhysics';
import type { AssetResolver } from '../assets/types';
import type { Vec3 } from '../core/Component';

globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;

const DT = 1 / 60;

/** In-memory script assets: id → source text. */
class ScriptResolver implements AssetResolver {
  sources = new Map<string, string>();
  async resolve(id: string) {
    const src = this.sources.get(id);
    if (src === undefined) return undefined;
    return {
      id,
      type: 'script' as const,
      name: `${id}.easy`,
      main: 'main.easy',
      files: ['main.easy'],
      url: () => `data:text/plain;charset=utf-8,${encodeURIComponent(src)}`,
    };
  }
}

async function setup() {
  const rapier = await loadPhysics();
  const world = new World();
  const render = new RenderSystem(new THREE.Scene());
  world.addSystem(render);
  const keys = new EventTarget();
  const input = new Input(keys);
  const physics = new PhysicsSystem(rapier, render, { input, camera: () => new THREE.PerspectiveCamera() });
  world.addSystem(physics);
  const assets = new AssetManager();
  const resolver = new ScriptResolver();
  assets.resolver = resolver;
  const hudLog: string[] = [];
  const hud = {
    setText: (slot: string, t: string | null) => hudLog.push(`${slot}=${t}`),
    say: (t: string) => hudLog.push(`say:${t}`),
    setBar: (slot: string, label: string, f: number) => hudLog.push(`${slot}=bar:${label}:${f}`),
    dialog: (who: string, t: string) => hudLog.push(`dialog:${who}:${t}`),
    clear: () => {},
  };
  const scripts = new ScriptSystem({ assets, physics, input, hud: hud as never });
  world.addSystem(scripts);
  const logs: ScriptLog[] = [];
  scripts.events.on('log', (l) => logs.push(l));

  const frames = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      world.fixedUpdate(DT);
      world.update(DT);
      input.endFrame();
    }
  };
  const play = async () => {
    physics.setSimulating(true);
    await scripts.setRunning(true);
  };
  const press = (code: string) => keys.dispatchEvent(Object.assign(new Event('keydown'), { code }));
  const release = (code: string) => keys.dispatchEvent(Object.assign(new Event('keyup'), { code }));
  const object = (name: string, position: Vec3 = [0, 0, 0]) => {
    const e = world.createEntity({ name });
    e.add(Transform, { position });
    return e;
  };
  const scripted = (name: string, source: string, position: Vec3 = [0, 0, 0]) => {
    resolver.sources.set(name, source);
    const e = object(name, position);
    e.add(Script, { script: name });
    return e;
  };
  const messages = () => logs.map((l) => `${l.level}: ${l.message}`);
  return { world, physics, scripts, assets, resolver, input, logs, messages, hudLog, frames, play, press, release, object, scripted };
}

const pos = (e: { require: (d: typeof Transform) => { position: Vec3 } }) => e.require(Transform).position;

describe('ScriptSystem', () => {
  it('runs start, variables, if/else, repeat and text', async () => {
    const t = await setup();
    t.scripted(
      'Counter',
      `{
        props: { hp: 10 },
        on: {
          start: [
            { subtract: "self.hp", value: 3 },
            { if: "self.hp < 8", then: [ { log: "low {self.hp}" } ], else: [ { log: "fine" } ] },
            { repeat: 3, do: [ { add: "game.total", value: "index" } ] },
            { log: "total {game.total}" },
            { set: "game.name", to: "'Bob'" },
            { log: "Hi {game.name}!" },
          ],
        },
      }`,
    );
    await t.play();
    expect(t.messages()).toEqual(['info: low 7', 'info: total 3', 'info: Hi Bob!']);
  });

  it('the Coin example: player touches → score +1, coin disappears', async () => {
    const t = await setup();
    const ground = t.object('Ground', [0, -0.5, 0]);
    ground.set(Transform, { scale: [40, 1, 40] });
    ground.add(MeshRenderer);
    ground.add(Collider);
    const player = t.object('Hero');
    player.add(CharacterController);
    player.add(Traits, { traits: ['player'] });
    const coin = t.scripted(
      'Coin',
      `{
        traits: ["trigger"],
        on: {
          touch: [
            { if: "other.is('player')" },
            { add: "game.score", value: 1 },
            { log: "Score: {game.score}" },
            { destroy: "self" },
          ],
        },
      }`,
      [0, 1, -2],
    );
    coin.add(MeshRenderer, { shape: 'sphere' });
    await t.play();
    t.frames(0.3);
    t.press('KeyW');
    t.frames(1);
    expect(t.scripts.game.score).toBe(1);
    expect(t.messages()).toContain('info: Score: 1');
    expect(t.world.getById(coin.id)).toBeUndefined();
  });

  it('collectible trait works with zero code', async () => {
    const t = await setup();
    const ground = t.object('Ground', [0, -0.5, 0]);
    ground.set(Transform, { scale: [40, 1, 40] });
    ground.add(Collider);
    const player = t.object('Hero');
    player.add(Traits, { traits: ['player'] });
    for (const z of [-1.5, -3]) {
      const c = t.object('Coin', [0, 1, z]);
      c.add(MeshRenderer, { shape: 'sphere' });
      c.add(Traits, { traits: ['collectible', 'spinning'] });
    }
    await t.play();
    t.press('KeyW');
    t.frames(1.2);
    expect(t.scripts.game.score).toBe(2);
    expect(t.hudLog).toContain('top-left=Score: 2');
  });

  it('wait and smooth moves take real time', async () => {
    const t = await setup();
    const box = t.scripted('Mover', `{ on: { start: [ { wait: 0.5 }, { move: [0, 2, 0], time: 1 }, { log: "arrived" } ] } }`);
    await t.play();
    t.frames(0.4);
    expect(pos(box)[1]).toBe(0);
    t.frames(0.6); // 0.5 wait + 0.5 of the move
    expect(pos(box)[1]).toBeGreaterThan(0.8);
    expect(pos(box)[1]).toBeLessThan(1.2);
    t.frames(0.6);
    expect(pos(box)[1]).toBeCloseTo(2, 3);
    expect(t.messages()).toContain('info: arrived');
  });

  it('timers, keys and update', async () => {
    const t = await setup();
    t.scripted(
      'Clock',
      `{
        on: {
          timer: [ { every: 0.5, do: [ { add: "game.ticks", value: 1 } ] }, { after: 1, do: [ { log: "one second" } ] } ],
          key: { space: [ { add: "game.jumps", value: 1 } ], e: [ { log: "use" } ] },
          update: [ { add: "game.frames", value: 1 } ],
        },
      }`,
    );
    await t.play();
    t.frames(1.05);
    expect(t.scripts.game.ticks).toBe(2);
    expect(t.messages()).toContain('info: one second');
    t.press('Space');
    t.frames(DT);
    t.release('Space');
    t.frames(DT);
    expect(t.scripts.game.jumps).toBe(1); // once per press, not per frame
    expect(Number(t.scripts.game.frames)).toBeGreaterThan(60);
  });

  it('functions with args, called on other objects; messages', async () => {
    const t = await setup();
    const target = t.scripted(
      'Target',
      `{
        props: { hp: 100 },
        functions: { hurt: [ { subtract: "self.hp", value: "$amount" }, { log: "{self.name} hp {self.hp}, hit by {other.name}" } ] },
        on: { message: { ping: [ { log: "pong from {self.name}" } ] } },
      }`,
    );
    t.scripted(
      'Attacker',
      `{ on: { start: [ { call: "hurt", on: "Target", args: { amount: 30 } }, { send: "ping", to: "all" } ] } }`,
    );
    await t.play();
    expect(t.scripts.getVar(target, 'hp')).toBe(70);
    expect(t.messages()).toEqual(['info: Target hp 70, hit by Attacker', 'info: pong from Target']);
  });

  it('health + damaging traits: player respawns at the checkpoint', async () => {
    const t = await setup();
    const ground = t.object('Ground', [0, -0.5, 0]);
    ground.set(Transform, { scale: [40, 1, 40] });
    ground.add(Collider);
    const player = t.object('Hero');
    player.add(Traits, { traits: ['player', 'health'] });
    player.add(Script, { script: '', props: { health: 30 } });
    const flag = t.object('Flag', [0, 1, -1.5]);
    flag.add(Traits, { traits: ['checkpoint'] });
    const spikes = t.object('Spikes', [0, 0.5, -4]);
    spikes.add(MeshRenderer);
    spikes.add(Traits, { traits: ['damaging'] });
    spikes.add(Script, { script: '', props: { damage: 50 } });
    await t.play();
    t.press('KeyW');
    // Walk until the spikes send us back, then stop walking.
    for (let i = 0; i < 180 && !t.messages().some((m) => m.includes('Back to the checkpoint')); i++) t.frames(DT);
    t.release('KeyW');
    t.frames(0.2);
    expect(t.scripts.game.checkpoint).toBeDefined();
    expect(t.messages()).toEqual(expect.arrayContaining(['info: Message: Checkpoint!', 'info: Message: Ouch! Back to the checkpoint.']));
    expect(t.scripts.getVar(player, 'health')).toBe(100); // refilled to maxHealth after respawn
    expect(pos(player)[2]).toBeGreaterThan(-2.5); // back near the flag, not at the spikes
  });

  it('obby: a kill brick sends the player back to the checkpoint', async () => {
    const t = await setup();
    const ground = t.object('Ground', [0, -0.5, 0]);
    ground.set(Transform, { scale: [40, 1, 40] });
    ground.add(Collider);
    const player = t.object('Hero');
    player.add(Traits, { traits: ['player'] });
    const flag = t.object('Flag', [0, 1, -1.5]);
    flag.add(Traits, { traits: ['checkpoint'] });
    const lava = t.object('Lava', [0, 0.25, -4]);
    lava.add(MeshRenderer);
    lava.set(Transform, { scale: [4, 0.5, 1] });
    lava.add(Traits, { traits: ['deadly'] });
    await t.play();
    expect(lava.require(MeshRenderer).color).toBe('#d63a2f');
    t.press('KeyW');
    let furthest = 0;
    for (let i = 0; i < 150; i++) {
      t.frames(DT);
      furthest = Math.min(furthest, pos(player)[2]);
      if (furthest < -3 && pos(player)[2] > -2.5) break; // reached the lava and came back
    }
    t.release('KeyW');
    expect(furthest).toBeLessThan(-3);
    expect(pos(player)[2]).toBeGreaterThan(-2.5);
  });

  it('obby: disappearing platforms fade, let you through, then come back', async () => {
    const t = await setup();
    const player = t.object('Hero', [0, 0.02, 0]); // standing on the tile
    player.add(Traits, { traits: ['player'] });
    const tile = t.object('Tile', [0, -0.25, 0]);
    tile.add(MeshRenderer);
    tile.set(Transform, { scale: [3, 0.5, 3] });
    tile.add(Traits, { traits: ['disappearing'] });
    tile.add(Script, { script: '', props: { delay: 0.3, returnAfter: 1 } });
    await t.play();
    t.frames(0.8); // touched, faded, gone
    expect(tile.require(Collider).isTrigger).toBe(true); // gone: you fall through
    expect(tile.require(MeshRenderer).opacity).toBeLessThan(0.2);
    expect(pos(player)[1]).toBeLessThan(-0.5);
    t.frames(1.2);
    expect(tile.require(Collider).isTrigger).toBe(false); // back
    expect(tile.require(MeshRenderer).opacity).toBe(1);
  });

  it('obby: moving platforms go to their offset and back', async () => {
    const t = await setup();
    const lift = t.object('Lift', [0, 0, 0]);
    lift.add(MeshRenderer);
    lift.add(Traits, { traits: ['moving-platform'] });
    lift.add(Script, { script: '', props: { offset: [0, 4, 0], time: 1, pause: 0.2 } });
    await t.play();
    t.frames(1.1);
    expect(pos(lift)[1]).toBeCloseTo(4, 1);
    t.frames(1.3);
    expect(pos(lift)[1]).toBeCloseTo(0, 1);
  });

  it('spawn copies a (hidden) template; destroy removes', async () => {
    const t = await setup();
    const template = t.object('Spark', [0, 0, 0]);
    template.enabled = false;
    t.scripted('Spawner', `{ on: { start: [ { repeat: 3, do: [ { spawn: "Spark", at: "[index, 5, 0]" } ] } ] } }`);
    await t.play();
    const sparks = [...t.world.all()].filter((e) => e.name === 'Spark');
    expect(sparks).toHaveLength(4);
    expect(sparks.filter((e) => e.enabled).map((e) => pos(e))).toEqual([
      [0, 5, 0],
      [1, 5, 0],
      [2, 5, 0],
    ]);
  });

  it('stops endless loops with a helpful error instead of freezing', async () => {
    const t = await setup();
    t.scripted('Loop', `{ on: { start: [ { repeat: "forever", do: [ { add: "game.n", value: 1 } ] } ] } }`);
    await t.play();
    expect(t.messages().some((m) => /endless loop — add a \{ wait \}/.test(m))).toBe(true);
  });

  it('forever loops with waits are fine (patrolling trait)', async () => {
    const t = await setup();
    const guard = t.object('Guard');
    guard.add(Traits, { traits: ['patrolling'] });
    guard.add(Script, { script: '', props: { distance: 2, time: 0.5 } });
    await t.play();
    // Watch 2 seconds: it should go 0 → 2 → 0 → 2 … (each leg 0.5 s).
    const xs: number[] = [];
    for (let i = 0; i < 120; i++) {
      t.frames(DT);
      xs.push(pos(guard)[0]);
    }
    expect(Math.max(...xs)).toBeCloseTo(2, 2);
    expect(Math.min(...xs.slice(40))).toBeLessThan(0.1);
    let turns = 0;
    for (let i = 2; i < xs.length; i++) if (Math.sign(xs[i] - xs[i - 1]) !== Math.sign(xs[i - 1] - xs[i - 2]) && xs[i] !== xs[i - 1]) turns++;
    expect(turns).toBeGreaterThanOrEqual(3);
  });

  it('runtime errors name the script and line, other scripts keep running', async () => {
    const t = await setup();
    t.scripted('Broken', `{\n  on: {\n    start: [\n      { moveTo: "nothing" },\n    ],\n  },\n}`);
    t.scripted('Fine', `{ on: { start: [ { log: "still running" } ] } }`);
    await t.play();
    const m = t.messages();
    expect(m.some((x) => /Broken › Broken\.easy: line 4 \(moveTo\): expected a position/.test(x))).toBe(true);
    expect(m).toContain('info: still running');
  });

  it('scripts with compile errors report and do not run', async () => {
    const t = await setup();
    t.scripted('Typo', `{ on: { start: [ { lgo: "x" } ] } }`);
    await t.play();
    expect(t.messages()[0]).toMatch(/Typo\.easy line 1: "lgo" isn't an action. Did you mean "log"\?/);
  });

  it('hot reload: editing a script while playing applies it and keeps values', async () => {
    const t = await setup();
    const e = t.scripted('Live', `{ props: { n: 0 }, on: { key: { space: [ { add: "self.n", value: 1 } ] } } }`);
    await t.play();
    t.press('Space');
    t.frames(DT);
    t.release('Space');
    t.resolver.sources.set('Live', `{ props: { n: 0 }, on: { key: { space: [ { add: "self.n", value: 10 } ] } } }`);
    t.assets.invalidate('Live');
    await new Promise((r) => setTimeout(r, 20));
    t.press('Space');
    t.frames(DT);
    expect(t.scripts.getVar(e, 'n')).toBe(11);
    expect(t.messages().some((m) => /Reloaded/.test(m))).toBe(true);
  });

  it('a paused frame (dt 0) freezes timers and does not consume key presses', async () => {
    const t = await setup();
    t.scripted('P', `{ on: { timer: { every: 0.1, do: [ { add: "game.ticks", value: 1 } ] }, key: { space: [ { add: "game.jumps", value: 1 } ] } } }`);
    await t.play();
    t.press('Space');
    for (let i = 0; i < 30; i++) t.world.update(0); // paused for 30 frames, input not cleared
    expect(t.scripts.game.ticks).toBeUndefined();
    expect(t.scripts.game.jumps).toBeUndefined();
    t.frames(DT); // resume: the held press is handled once
    expect(t.scripts.game.jumps).toBe(1);
  });

  it('useCamera switches which camera the game looks through', async () => {
    const t = await setup();
    const a = t.object('Office Cam');
    a.add('Camera', { primary: true });
    const b = t.object('Hallway Cam');
    b.add('Camera', { primary: false });
    t.scripted('Monitor', `{ on: { key: { space: [ { useCamera: "Hallway Cam" } ], e: [ { useCamera: "Office Cam" } ] } } }`);
    await t.play();
    t.press('Space');
    t.frames(DT);
    expect((b.get('Camera') as { primary: boolean }).primary).toBe(true);
    expect((a.get('Camera') as { primary: boolean }).primary).toBe(false);
    t.release('Space');
    t.press('KeyE');
    t.frames(DT);
    expect((a.get('Camera') as { primary: boolean }).primary).toBe(true);
  });

  it('nothing runs when not playing, and stopping clears state', async () => {
    const t = await setup();
    t.scripted('S', `{ on: { start: [ { set: "game.ran", to: true } ] } }`);
    t.frames(0.2);
    expect(t.scripts.game.ran).toBeUndefined();
    await t.play();
    expect(t.scripts.game.ran).toBe(true);
    await t.scripts.setRunning(false);
    expect(t.scripts.game.ran).toBeUndefined();
  });

  describe('traits in 2D games', () => {
    async function flat() {
      const t = await setup();
      t.physics.flat = true;
      const facing = new Map<string, boolean>();
      (t.scripts as unknown as { host: { sprites: unknown } }).host.sprites = {
        setFacing: (id: string, left: boolean) => facing.set(id, left),
        facingLeft: (id: string) => facing.get(id) ?? false,
      };
      const sprite = (name: string, position: Vec3, traits: string[], data: Partial<{ color: string; size: [number, number] }> = {}) => {
        const e = t.object(name, position);
        e.add(Sprite, data);
        e.add(Traits, { traits });
        return e;
      };
      return { ...t, facing, sprite };
    }

    it('moving platforms go sideways and spinning things turn like a wheel', async () => {
      const t = await flat();
      const lift = t.sprite('Lift', [0, 0, 0], ['moving-platform'], { size: [3, 0.5] });
      const saw = t.sprite('Saw', [5, 3, 0], ['spinning']);
      await t.play();
      t.frames(3.1);
      expect(pos(lift)[0]).toBeCloseTo(6, 1);
      expect(pos(lift)[2]).toBe(0);
      const r = saw.require(Transform).rotation;
      expect(Math.abs(r[2])).toBeGreaterThan(200);
      expect(r[1]).toBe(0);
    });

    it('doors fade and let you through; disappearing sprites fade', async () => {
      const t = await flat();
      const hero = t.sprite('Hero', [0, 0, 0], ['player']);
      const door = t.sprite('Door', [1.5, 1, 0], ['door'], { size: [0.4, 2] });
      const tile = t.sprite('Tile', [0, -0.5, 0], ['disappearing'], { size: [3, 0.5] });
      tile.add(Script, { script: '', props: { delay: 0.2, returnAfter: 5 } });
      await t.play();
      t.frames(0.6);
      expect(tile.require(Sprite).opacity).toBeLessThan(0.2);
      expect(t.scripts.game.interactTarget).toBe(door.id);
      t.press('KeyE');
      t.frames(DT);
      t.release('KeyE');
      t.frames(0.2);
      expect(door.require(Collider).isTrigger).toBe(true);
      expect(door.require(Sprite).opacity).toBeCloseTo(0.3);
      expect(door.require(Transform).rotation[1]).toBe(0);
      void hero;
    });

    it('things face left or right instead of turning edge-on, and are carried beside you', async () => {
      const t = await flat();
      const ground = t.object('Ground', [0, -0.5, 0]);
      ground.set(Transform, { scale: [60, 1, 60] });
      ground.add(Collider);
      const hero = t.sprite('Hero', [-2, 0, 0], ['player']);
      const npc = t.sprite('Guide', [0, 0.5, 0], ['npc']);
      const crate = t.sprite('Crate', [-3.2, 0.5, 0], ['pickup'], { size: [0.6, 0.6] });
      await t.play();
      t.frames(0.2);
      expect(t.scripts.game.interactTarget).toBe(crate.id);
      t.press('KeyE');
      t.frames(DT);
      t.release('KeyE');
      t.frames(0.2);
      expect(pos(crate)[2]).toBeCloseTo(0);
      expect(pos(crate)[0]).toBeGreaterThan(pos(hero)[0] + 0.5); // facing right: on the right
      t.facing.set(hero.id, true);
      t.frames(0.1);
      expect(pos(crate)[0]).toBeLessThan(pos(hero)[0] - 0.5);
      expect(npc.require(Transform).rotation).toEqual([0, 0, 0]);
    });

    it('ladders are passed in front of; water and kill bricks get their colour', async () => {
      const t = await flat();
      const ladder = t.sprite('Ladder', [0, 1, 0], ['climbable']);
      const lava = t.sprite('Lava', [4, 0, 0], ['deadly']);
      const pool = t.sprite('Pool', [8, 0, 0], ['water']);
      await t.play();
      t.frames(DT);
      expect(ladder.require(Collider).isTrigger).toBe(true);
      expect(lava.require(Sprite).color).toBe('#d63a2f');
      expect(pool.require(Sprite).color).toBe('#2f6f8f');
      expect(pool.require(Sprite).opacity).toBeCloseTo(0.72);
    });
  });

  describe('world traits', () => {
    async function arena() {
      const t = await setup();
      const ground = t.object('Ground', [0, -0.5, 0]);
      ground.set(Transform, { scale: [60, 1, 60] });
      ground.add(Collider);
      const hero = t.object('Hero');
      hero.add(Traits, { traits: ['player', 'health'] });
      return { ...t, hero };
    }
    const tap = async (t: Awaited<ReturnType<typeof arena>>, code: string) => {
      t.press(code);
      t.frames(DT);
      t.release(code);
      t.frames(DT);
    };

    it('door: walk up, press E, it swings open; E again closes it', async () => {
      const t = await arena();
      const door = t.object('Door', [0, 1, -2]);
      door.add(MeshRenderer);
      door.set(Transform, { scale: [1.2, 2, 0.1] });
      door.add(Traits, { traits: ['door'] });
      await t.play();
      t.frames(0.3);
      expect(t.hudLog).toContain('bottom=Press E to open');
      expect(t.scripts.game.interactTarget).toBe(door.id);
      await tap(t, 'KeyE');
      t.frames(0.8);
      expect(door.require(Transform).rotation[1]).toBeCloseTo(90, 0);
      expect(t.hudLog).toContain('bottom=Press E to close');
      await tap(t, 'KeyE');
      t.frames(0.8);
      expect(door.require(Transform).rotation[1]).toBeCloseTo(0, 0);
    });

    it('npc: press E nearby to hear its line in a dialog box', async () => {
      const t = await arena();
      const npc = t.object('Old Man', [0, 0, -2]);
      npc.add(Traits, { traits: ['npc'] });
      npc.add(Script, { script: '', props: { line: 'Mind the cliffs.' } });
      await t.play();
      t.frames(0.2);
      expect(t.hudLog).toContain('bottom=Press E to talk');
      await tap(t, 'KeyE');
      expect(t.hudLog).toContain('dialog:Old Man:Mind the cliffs.');
    });

    it('enemy: chases the player and hits them, respecting its cooldown', async () => {
      const t = await arena();
      const bot = t.object('Grunt', [6, 0, 0]);
      bot.add(Traits, { traits: ['enemy'] });
      bot.add(Script, { script: '', props: { damage: 10, cooldown: 1 } });
      await t.play();
      t.frames(3);
      expect(pos(bot)[0]).toBeLessThan(2); // walked over to us
      const hp = t.scripts.getVar(t.hero, 'health') as number;
      expect(hp).toBeLessThan(100);
      expect(hp).toBeGreaterThanOrEqual(70); // a few hits, not one per frame
      expect(t.hudLog.some((h) => /^top-right=bar:Health:0\.9/.test(h))).toBe(true);
    });

    it('pickup: E carries it in front of the player, E again drops it and it falls', async () => {
      const t = await arena();
      const box = t.object('Box', [0, 0.3, -1.5]);
      box.add(MeshRenderer);
      box.set(Transform, { scale: [0.5, 0.5, 0.5] });
      box.add(Traits, { traits: ['pickup'] });
      await t.play();
      t.frames(0.5);
      expect(t.scripts.game.interactTarget).toBe(box.id);
      await tap(t, 'KeyE');
      t.press('KeyD'); // walk sideways while carrying
      t.frames(1);
      t.release('KeyD');
      t.frames(0.1);
      expect(pos(box)[0]).toBeGreaterThan(2.5); // came along
      expect(pos(box)[1]).toBeGreaterThan(0.6); // held up at chest height
      await tap(t, 'KeyE');
      t.frames(1.5);
      expect(pos(box)[1]).toBeLessThan(0.4); // dropped onto the ground
    });

    it('E only reaches the nearest interactable (a crate next to a talker)', async () => {
      const t = await arena();
      const npc = t.object('Talker', [0, 0, -2.4]);
      npc.add(Traits, { traits: ['npc'] });
      const box = t.object('Crate', [0.5, 0.3, -1.2]);
      box.add(MeshRenderer);
      box.set(Transform, { scale: [0.5, 0.5, 0.5] });
      box.add(Traits, { traits: ['pickup'] });
      await t.play();
      t.frames(0.3);
      expect(t.scripts.game.interactTarget).toBe(box.id); // the crate is closer
      await tap(t, 'KeyE');
      expect(t.scripts.getVar(box, 'held') ?? null).toBeNull(); // 'held' is a live property, not a stored var
      expect(t.hudLog.some((h) => h.startsWith('dialog:'))).toBe(false); // the talker stayed quiet
      expect(t.hudLog).toContain('bottom=Press E to drop');
    });

    it('climbable and water traits need no code', async () => {
      const t = await arena();
      const wall = t.object('Vines', [0, 3, -1.2]);
      wall.add(MeshRenderer);
      wall.set(Transform, { scale: [2, 6, 0.2] });
      wall.add(Traits, { traits: ['climbable'] });
      const lake = t.object('Lake', [10, -0.5, 0]);
      lake.add(MeshRenderer);
      lake.set(Transform, { scale: [6, 3, 6] });
      lake.add(Traits, { traits: ['water'] });
      await t.play();
      t.press('KeyW');
      t.frames(1.2);
      expect(t.physics.isClimbing(t.hero)).toBe(true);
      expect(lake.get(MeshRenderer)!.opacity).toBeLessThan(1); // water look applied
    });
  });

  it('dynamic bodies can be pushed and teleported by scripts', async () => {
    const t = await setup();
    const ground = t.object('Ground', [0, -0.5, 0]);
    ground.set(Transform, { scale: [40, 1, 40] });
    ground.add(Collider);
    const ball = t.scripted('Ball', `{ on: { key: { space: [ { push: [0, 6, 0] } ], e: [ { moveTo: [5, 3, 0] } ] } } }`, [0, 0.5, 0]);
    ball.add(MeshRenderer, { shape: 'sphere' });
    ball.add(RigidBody);
    await t.play();
    t.frames(0.5);
    t.press('Space');
    t.frames(0.15);
    expect(pos(ball)[1]).toBeGreaterThan(1);
    t.release('Space');
    t.press('KeyE');
    t.frames(DT);
    expect(pos(ball)[0]).toBeCloseTo(5, 1);
  });

  it('reads and changes any component field from code', async () => {
    const t = await setup();
    const label = t.object('Score Label');
    label.add(UIText, { text: 'Score' });
    const lamp = t.object('Lamp');
    lamp.add(Light, { intensity: 1 });
    const dot = t.object('Dot');
    dot.add(UIPanel);
    t.scripted(
      'Director',
      `{
        on: {
          start: [
            { set: "find('Score Label').UIText.text", to: "'Score 5'" },
            { set: "find('Score Label').UIText.offset", to: "vec3(12, -4, 99)" },
            { set: "Lamp.Light.intensity", to: "Lamp.Light.intensity * 3" },
            { set: "Dot.UIPanel.offset.x", to: 30 },
            { log: "has light {exists(Lamp.Light)}, label light {exists(find('Score Label').Light)}" },
            { set: "Lamp.Light.kind", to: "'spotlite'" },
          ],
        },
      }`,
    );
    await t.play();
    expect(label.get(UIText)!.text).toBe('Score 5');
    expect(label.get(UIText)!.offset).toEqual([12, -4]);
    expect(lamp.get(Light)!.intensity).toBe(3);
    expect(dot.get(UIPanel)!.offset[0]).toBe(30);
    expect(t.messages()).toContain('info: has light true, label light false');
    // Wrong values explain themselves.
    expect(t.messages().some((m) => m.startsWith('error:') && m.includes('Light.kind can be') && m.includes('"spot"'))).toBe(true);
  });

  it('angle helpers for compasses and turrets', async () => {
    const t = await setup();
    t.object('North', [0, 0, -10]);
    t.object('East', [10, 0, 0]);
    t.scripted('Probe', `{ on: { start: [ { log: "{angleTo(self, North)} {angleTo(self, East)} {wrapAngle(270)} {wrapAngle(-190)}" } ] } }`);
    await t.play();
    expect(t.messages()).toEqual(['info: 180 90 -90 170']);
  });
});

describe('game pause (menus)', () => {
  it('pauses and resumes from a key; while paused nothing moves but keys still work', async () => {
    const t = await setup();
    let paused = false;
    (t.scripts as unknown as { host: { game: unknown } }).host.game = { pause: (on: boolean) => (paused = on), restart: () => {}, paused: () => paused };
    t.scripted('Clock', `{ on: { update: [ { add: "game.ticks", value: 1 } ] } }`);
    t.scripted(
      'Pause Menu',
      `{
        on: { key: { pause: [ { call: "toggle" } ] } },
        functions: {
          toggle: [ { if: "game.paused", then: [ { resume: true } ], else: [ { pause: true } ] } ],
        },
      }`,
    );
    await t.play();
    // One frame the way the engine runs it: paused → only keys.
    const frame = () => {
      if (paused) t.scripts.pausedUpdate();
      else t.world.update(DT);
      t.input.endFrame();
    };
    const ticks = () => (t.scripts as unknown as { game: { ticks?: number } }).game.ticks ?? 0;
    for (let i = 0; i < 5; i++) frame();
    expect(ticks()).toBe(5);
    expect(t.scripts.listensFor(['escape', 'pause'])).toBe(true);
    t.press('KeyP');
    frame();
    t.release('KeyP');
    expect(paused).toBe(true);
    const frozen = ticks();
    for (let i = 0; i < 5; i++) frame();
    expect(ticks()).toBe(frozen);
    t.press('KeyP');
    frame();
    expect(paused).toBe(false);
    frame();
    expect(ticks()).toBeGreaterThan(frozen);
  });
});

describe('saved games', () => {
  it('saves and loads game values, positions, own values and what is gone', async () => {
    const { memorySaves } = await import('./saveGame');
    const t = await setup();
    const saves = memorySaves();
    (t.scripts as unknown as { host: { saves: unknown } }).host.saves = saves;
    const coin = t.object('Coin', [5, 0, 0]);
    const box = t.scripted(
      'Box',
      `{
        props: { hits: 0 },
        on: {
          key: {
            k: [ { add: "game.score", value: 3 }, { set: "self.hits", to: 2 }, { set: "game.best", to: "find('Box')" }, { save: "'slot1'" } ],
            l: [ { load: "'slot1'" } ],
          },
        },
      }`,
      [1, 2, 3],
    );
    await t.play();
    t.world.destroyEntity(coin);
    t.press('KeyK');
    t.frames(DT);
    t.release('KeyK');
    expect(saves.read('slot1')).toContain('ege-save');
    // Change everything, then load.
    box.set(Transform, { position: [9, 9, 9] });
    (t.scripts as unknown as { game: Record<string, unknown> }).game.score = 100;
    t.press('KeyL');
    t.frames(DT);
    expect(pos(box)).toEqual([1, 2, 3]);
    const game = (t.scripts as unknown as { game: Record<string, unknown> }).game;
    expect(game.score).toBe(3);
    expect((game.best as { name: string }).name).toBe('Box'); // object references come back
    expect(t.scripts.getVar(box, 'hits')).toBe(2);
  });
});

describe('trait values per object', () => {
  it('uses this object\'s own values over the trait\'s defaults', async () => {
    const t = await setup();
    const coin = t.object('Coin');
    coin.add(Traits, { traits: ['collectible'], props: { points: 5 } });
    const other = t.object('Coin 2');
    other.add(Traits, { traits: ['collectible'] });
    await t.play();
    t.frames(DT);
    expect(t.scripts.getVar(coin, 'points')).toBe(5);
    expect(t.scripts.getVar(other, 'points')).toBe(1);
  });
});
