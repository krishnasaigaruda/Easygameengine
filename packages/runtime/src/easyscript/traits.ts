import type { Entity } from '../core/Entity';
import { CharacterController, Climbable, Collider, RigidBody, Water } from '../components/physics';
import { MeshRenderer, ModelRenderer } from '../components/builtin';
import { Sprite } from '../components/sprite';

/**
 * Traits: one word = a whole feature. Each trait can
 *  - `setup` the object when the game starts (add a collider, make it a trigger…), and/or
 *  - bring an EasyScript `script` (written in the same language users write).
 * Setup only adds what's missing, and play mode restores the scene on Stop, so nothing sticks.
 */
export interface TraitDef {
  name: string;
  label: string;
  icon: string;
  description: string;
  category: 'Physics' | 'Gameplay' | 'Movement' | 'World';
  /** `flat`: a 2D game. */
  setup?: (e: Entity, flat: boolean) => void;
  /** EasyScript source (JSON5). */
  script?: string;
  /** Used instead of `script` in 2D games, where turning or moving in depth can't be seen. */
  script2D?: string;
  /** Not built yet: accepted with a warning. */
  comingIn?: string;
}

const ensureCollider = (e: Entity, patch: Record<string, unknown> = {}) => {
  if (e.has(Collider)) {
    if (Object.keys(patch).length) e.set(Collider, patch);
  } else e.add(Collider, patch);
};

/** Give a plain look a colour (only if it still has the default one): 3D meshes and 2D shapes. */
const recolor = (e: Entity, color: string, opacity?: number) => {
  const m = e.get(MeshRenderer);
  if (m && m.color === '#cccccc') e.set(MeshRenderer, { color });
  const sp = e.get(Sprite);
  if (sp && !sp.image && sp.color.toLowerCase() === '#ffffff') e.set(Sprite, { color });
  if (sp && opacity !== undefined && (sp.opacity ?? 1) >= 1) e.set(Sprite, { opacity });
};

export const TRAITS: TraitDef[] = [
  // ── Physics ──
  {
    name: 'solid',
    label: 'Solid',
    icon: 'brick-wall',
    category: 'Physics',
    description: 'Things bump into it instead of passing through. It never moves.',
    setup: (e) => ensureCollider(e),
  },
  {
    name: 'pushable',
    label: 'Pushable',
    icon: 'package',
    category: 'Physics',
    description: 'Falls with gravity and can be pushed around.',
    setup: (e) => {
      ensureCollider(e);
      if (!e.has(RigidBody)) e.add(RigidBody, { type: 'dynamic' });
    },
  },
  {
    name: 'bouncy',
    label: 'Bouncy',
    icon: 'circle-dot',
    category: 'Physics',
    description: 'Things bounce off it (and it bounces if it can move).',
    setup: (e) => ensureCollider(e, { bounciness: 0.9 }),
  },
  {
    name: 'slippery',
    label: 'Slippery',
    icon: 'snowflake',
    category: 'Physics',
    description: 'No grip — things slide on it like ice.',
    setup: (e) => ensureCollider(e, { friction: 0 }),
  },
  {
    name: 'trigger',
    label: 'Trigger zone',
    icon: 'square-dashed',
    category: 'Physics',
    description: 'Invisible-wall-free zone: things pass through, but on.touch still fires.',
    setup: (e) => ensureCollider(e, { isTrigger: true }),
  },

  // ── Gameplay ──
  {
    name: 'player',
    label: 'Player',
    icon: 'person',
    category: 'Gameplay',
    description: 'The hero: walks with WASD / arrows, other traits know who "the player" is.',
    setup: (e) => {
      e.tags.add('player');
      if (!e.has(CharacterController)) e.add(CharacterController);
    },
  },
  {
    name: 'collectible',
    label: 'Collectible',
    icon: 'sparkles',
    category: 'Gameplay',
    description: 'The player picks it up on touch: adds "points" to game.score and disappears.',
    setup: (e) => ensureCollider(e, { isTrigger: true }),
    script: `{
      props: { points: 1 },
      on: {
        touch: [
          { if: "other.is('player')" },
          { add: "game.score", value: "self.points" },
          { hud: "Score: {game.score}" },
          { destroy: "self" },
        ],
      },
    }`,
  },
  {
    name: 'health',
    label: 'Has health',
    icon: 'heart',
    category: 'Gameplay',
    description: 'Can be hurt and healed. At 0 it goes back to the last checkpoint (player) or is destroyed (adding "reward" to game.score).',
    script: `{
      props: { health: 100, maxHealth: 100, reward: 0 },
      on: {
        start: [ { call: "showHealth" } ],
      },
      functions: {
        takeDamage: [
          { if: "not self.dead" },
          { subtract: "self.health", value: "$amount" },
          { set: "self.health", to: "max(self.health, 0)" },
          { call: "showHealth" },
          { if: "self.health > 0 and self.has('Animator')", then: [ { animate: "'hurt'" } ] },
          { if: "self.health <= 0", then: [ { call: "die" } ] },
        ],
        heal: [
          { add: "self.health", value: "$amount" },
          { set: "self.health", to: "min(self.health, self.maxHealth)" },
          { call: "showHealth" },
        ],
        showHealth: [ { if: "self.is('player')", then: [ { bar: "self.health / self.maxHealth", label: "Health" } ] } ],
        die: [
          {
            if: "self.is('player')",
            then: [
              { send: "playerDied" },
              { say: "Ouch! Back to the checkpoint." },
              { add: "game.deaths", value: 1 },
              { moveTo: "exists(game.checkpoint) ? game.checkpoint : self.startPosition" },
              { set: "self.health", to: "self.maxHealth" },
              { call: "showHealth" },
            ],
            else: [
              { set: "self.dead", to: true },
              { add: "game.kills", value: 1 },
              { add: "game.score", value: "self.reward" },
              { if: "self.has('Animator')", then: [ { animate: "'die'" }, { wait: 2 } ] },
              { destroy: "self" },
            ],
          },
        ],
      },
    }`,
  },
  {
    name: 'damaging',
    label: 'Damaging',
    icon: 'flame',
    category: 'Gameplay',
    description: 'Hurts things with health that touch it ("damage" per touch).',
    setup: (e) => ensureCollider(e),
    script: `{
      props: { damage: 25 },
      on: {
        touch: [ { if: "other.has('takeDamage')" }, { call: "takeDamage", on: "other", args: { amount: "self.damage" } } ],
      },
    }`,
  },
  {
    name: 'healing',
    label: 'Healing',
    icon: 'heart-pulse',
    category: 'Gameplay',
    description: 'Heals things with health that touch it, then disappears.',
    setup: (e) => ensureCollider(e, { isTrigger: true }),
    script: `{
      props: { heal: 25 },
      on: {
        touch: [ { if: "other.has('heal')" }, { call: "heal", on: "other", args: { amount: "self.heal" } }, { destroy: "self" } ],
      },
    }`,
  },
  {
    name: 'checkpoint',
    label: 'Checkpoint',
    icon: 'flag',
    category: 'Gameplay',
    description: 'When the player passes it, this becomes where they come back after falling or dying.',
    setup: (e) => ensureCollider(e, { isTrigger: true }),
    script: `{
      on: {
        touch: [
          { if: "other.is('player') and game.checkpoint != self.position" },
          { set: "game.checkpoint", to: "self.position" },
          { say: "Checkpoint!" },
        ],
      },
    }`,
  },
  {
    name: 'kill-zone',
    label: 'Fall zone',
    icon: 'ban',
    category: 'Gameplay',
    description: 'Touching it sends the player back to the last checkpoint (put it under the level).',
    setup: (e) => ensureCollider(e, { isTrigger: true }),
    script: `{
      on: {
        touch: [
          { if: "other.is('player')" },
          { moveTo: "exists(game.checkpoint) ? game.checkpoint : other.startPosition", on: "other" },
          { add: "game.deaths", value: 1 },
          { say: "Whoops!" },
        ],
      },
    }`,
  },

  {
    name: 'deadly',
    label: 'Kill brick',
    icon: 'zap',
    category: 'Gameplay',
    description: 'Solid, but touching it sends the player back to the last checkpoint (lava, spikes, laser floors).',
    setup: (e) => {
      ensureCollider(e);
      recolor(e, '#d63a2f');
    },
    script: `{
      on: {
        touch: [
          { if: "other.is('player')" },
          { moveTo: "exists(game.checkpoint) ? game.checkpoint : other.startPosition", on: "other" },
          { add: "game.deaths", value: 1 },
        ],
      },
    }`,
  },
  {
    name: 'jump-pad',
    label: 'Jump pad',
    icon: 'upload-from',
    category: 'Movement',
    description: 'Launches the player into the air ("power" m/s up).',
    setup: (e) => ensureCollider(e),
    script: `{
      props: { power: 14 },
      on: {
        touch: [
          { if: "other.is('player')" },
          { velocity: "[0, self.power, 0]", on: "other" },
        ],
      },
    }`,
  },

  // ── Movement ──
  {
    name: 'moving-platform',
    label: 'Moving platform',
    icon: 'move-right',
    category: 'Movement',
    description: 'Glides to "offset" and back ("time" seconds each way, waiting "pause"). Players standing on it ride along.',
    setup: (e) => ensureCollider(e),
    script: `{
      props: { offset: [0, 0, 6], time: 3, pause: 0.5 },
      on: { start: [ { call: "cycle" } ] },
      functions: {
        cycle: [
          { move: "self.offset", time: "self.time" },
          { wait: "self.pause" },
          { move: "[-self.offset[0], -self.offset[1], -self.offset[2]]", time: "self.time" },
          { wait: "self.pause" },
          { call: "cycle" },
        ],
      },
    }`,
    // Sideways: moving in depth can't be seen in 2D.
    script2D: `{
      props: { offset: [6, 0, 0], time: 3, pause: 0.5 },
      on: { start: [ { call: "cycle" } ] },
      functions: {
        cycle: [
          { move: "self.offset", time: "self.time" },
          { wait: "self.pause" },
          { move: "[-self.offset[0], -self.offset[1], -self.offset[2]]", time: "self.time" },
          { wait: "self.pause" },
          { call: "cycle" },
        ],
      },
    }`,
  },
  {
    name: 'disappearing',
    label: 'Disappearing',
    icon: 'square-dashed',
    category: 'Movement',
    description: 'Fades away "delay" seconds after the player steps on it, then comes back after "returnAfter".',
    setup: (e) => ensureCollider(e),
    script: `{
      props: { delay: 0.6, returnAfter: 3 },
      on: {
        touch: [
          { if: "other.is('player') and not self.vanishing" },
          { set: "self.vanishing", to: true },
          { set: "self.opacity", to: 0.5 },
          { wait: "self.delay" },
          { set: "self.solid", to: false },
          { set: "self.opacity", to: 0.08 },
          { wait: "self.returnAfter" },
          { set: "self.solid", to: true },
          { set: "self.opacity", to: 1 },
          { set: "self.vanishing", to: false },
        ],
      },
    }`,
  },
  {
    name: 'spinning',
    label: 'Spinning',
    icon: 'rotate',
    category: 'Movement',
    description: 'Keeps turning around ("speed" degrees per second). Great for coins. In 2D it turns like a wheel.',
    script: `{
      props: { speed: 90 },
      on: { update: [ { rotate: "[0, self.speed * time.delta, 0]" } ] },
    }`,
    script2D: `{
      props: { speed: 90 },
      on: { update: [ { rotate: "[0, 0, self.speed * time.delta]" } ] },
    }`,
  },
  {
    name: 'floating',
    label: 'Floating',
    icon: 'cloud',
    category: 'Movement',
    description: 'Gently bobs up and down.',
    script: `{
      props: { height: 0.25, speed: 120 },
      on: {
        start: [ { set: "self.baseY", to: "self.y" } ],
        update: [ { set: "self.y", to: "self.baseY + sin(time.elapsed * self.speed) * self.height" } ],
      },
    }`,
  },
  {
    name: 'patrolling',
    label: 'Patrolling',
    icon: 'footprints',
    category: 'Movement',
    description: 'Walks back and forth ("distance" meters along X, "time" seconds each way). Someone you can talk to stops and faces you when you come close.',
    script: `{
      props: { distance: 4, time: 2 },
      on: {
        start: [ { call: "patrol" } ],
      },
      functions: {
        patrol: [
          { repeat: 4, do: [ { call: "waitForPlayer" }, { move: "[self.distance / 4, 0, 0]", time: "self.time / 4" } ] },
          { repeat: 4, do: [ { call: "waitForPlayer" }, { move: "[-self.distance / 4, 0, 0]", time: "self.time / 4" } ] },
          { call: "patrol" },
        ],
        waitForPlayer: [
          { if: "self.is('interactable') and distance(self, player) < 3.5", then: [ { lookAt: "player" }, { wait: 0.25 }, { call: "waitForPlayer" } ] },
        ],
      },
    }`,
  },

  // ── World ──
  {
    name: 'climbable',
    label: 'Climbable',
    icon: 'trending-up',
    category: 'World',
    description: 'The player climbs it by walking into it (ladders, vines, rock walls), or in 2D by standing in front of it and pressing up. Space jumps off.',
    // 2D ladders are in the background: walk in front of them, up climbs.
    setup: (e, flat) => {
      ensureCollider(e, flat ? { isTrigger: true } : {});
      if (!e.has(Climbable)) e.add(Climbable);
    },
  },
  {
    name: 'swimmable',
    label: 'Swimmable',
    icon: 'waves',
    category: 'World',
    description: 'The player swims inside it. Its top is the water surface. Space swims up.',
    setup: (e) => {
      ensureCollider(e, { isTrigger: true });
      if (!e.has(Water)) e.add(Water);
    },
  },
  {
    name: 'water',
    label: 'Water',
    icon: 'droplets',
    category: 'World',
    description: 'Swimmable, and looks like water (see-through blue).',
    setup: (e) => {
      ensureCollider(e, { isTrigger: true });
      if (!e.has(Water)) e.add(Water);
      const m = e.get(MeshRenderer);
      if (m && m.opacity >= 1) e.set(MeshRenderer, { color: m.color === '#cccccc' ? '#2f6f8f' : m.color, opacity: 0.72, roughness: 0.15, metalness: 0.1, castShadow: false });
      recolor(e, '#2f6f8f', 0.72);
    },
  },
  {
    name: 'door',
    label: 'Door',
    icon: 'door',
    category: 'World',
    description: 'Walk up and press E to open or close (swings "openAngle" degrees around its origin, the hinge; in 2D it fades and lets you through).',
    // A hinge is often an empty parent with the door panel inside: only solid if it has a look.
    setup: (e) => {
      e.tags.add('interactable');
      if (e.has(MeshRenderer) || e.has(ModelRenderer) || e.has(Sprite)) ensureCollider(e);
    },
    script: `{
      props: { openAngle: 90, time: 0.6, open: false, busy: false, interactRange: 2.5, prompt: "Press E to {self.open ? 'close' : 'open'}" },
      on: {
        key: {
          interact: [
            { if: "game.interactTarget == self.id and not self.busy" },
            { set: "self.busy", to: true },
            { if: "self.open",
              then: [ { rotate: "[0, -self.openAngle, 0]", time: "self.time" }, { set: "self.open", to: false } ],
              else: [ { rotate: "[0, self.openAngle, 0]", time: "self.time" }, { set: "self.open", to: true } ] },
            { set: "self.busy", to: false },
          ],
        },
      },
    }`,
    // 2D: a door swung open would still block the way (it's seen edge-on), so it fades and lets you through.
    script2D: `{
      props: { openAngle: 90, time: 0.6, open: false, busy: false, interactRange: 2.5, prompt: "Press E to {self.open ? 'close' : 'open'}" },
      on: {
        key: {
          interact: [
            { if: "game.interactTarget == self.id and not self.busy" },
            { if: "self.open",
              then: [ { set: "self.solid", to: true }, { set: "self.opacity", to: 1 }, { set: "self.open", to: false } ],
              else: [ { set: "self.solid", to: false }, { set: "self.opacity", to: 0.3 }, { set: "self.open", to: true } ] },
          ],
        },
      },
    }`,
  },
  {
    name: 'npc',
    label: 'Talks (NPC)',
    icon: 'users',
    category: 'World',
    description: 'Walk up and press E to hear its "line". Set the line in the object\'s Script values.',
    setup: (e) => {
      e.tags.add('interactable');
      ensureCollider(e);
    },
    script: `{
      props: { line: "Hello, traveler. The path ahead climbs into the mountains.", interactRange: 3, prompt: "Press E to talk" },
      on: {
        key: {
          interact: [ { if: "game.interactTarget == self.id" }, { lookAt: "player" }, { dialog: "{self.line}", speaker: "self.name" } ],
        },
      },
    }`,
  },
  {
    name: 'enemy',
    label: 'Enemy',
    icon: 'bot',
    category: 'Gameplay',
    description: 'Chases the player when it sees them ("sight" m) and hits them up close ("damage" per "cooldown" s).',
    setup: (e) => {
      e.tags.add('enemy');
      if (!e.has(CharacterController)) e.add(CharacterController, { playerControlled: false, speed: 2.5, runSpeed: 4 });
    },
    script: `{
      props: { sight: 10, attackRange: 1.6, damage: 15, cooldown: 1.2, lastHit: -10 },
      on: {
        update: [
          { if: "not self.dead and exists(player) and distance(self, player) < self.sight" },
          { chase: "player", stopAt: "self.attackRange * 0.75" },
          { if: "distance(self, player) < self.attackRange and time.elapsed - self.lastHit > self.cooldown and player.has('takeDamage')",
            then: [
              { set: "self.lastHit", to: "time.elapsed" },
              { if: "self.has('Animator')", then: [ { animate: "'attack'" } ] },
              { call: "takeDamage", on: "player", args: { amount: "self.damage" } },
            ] },
        ],
      },
    }`,
  },
  {
    name: 'pickup',
    label: 'Pickup',
    icon: 'hand',
    category: 'Gameplay',
    description: 'Walk up and press E to carry it; press E again to put it down. It falls and can be pushed.',
    setup: (e) => {
      e.tags.add('interactable');
      ensureCollider(e);
      if (!e.has(RigidBody)) e.add(RigidBody, { type: 'dynamic' });
    },
    script: `{
      props: { interactRange: 2, prompt: "Press E to {self.held ? 'drop' : 'pick up'}" },
      on: {
        key: {
          interact: [
            { if: "game.interactTarget == self.id" },
            { if: "self.held", then: [ { drop: "self" } ], else: [ { pickUp: "self", by: "player" } ] },
          ],
        },
      },
    }`,
  },
  {
    name: 'vehicle',
    label: 'Vehicle',
    icon: 'car',
    category: 'World',
    description: 'Can be driven.',
    comingIn: 'Phase 14',
  },
];

export const TRAIT_BY_NAME = new Map(TRAITS.map((t) => [t.name, t]));
export const READY_TRAITS = TRAITS.filter((t) => !t.comingIn).map((t) => t.name);
export const COMING_SOON_TRAITS = TRAITS.filter((t) => t.comingIn).map((t) => t.name);
