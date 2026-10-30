import type { Step } from './plan';

/*
 * Whole games for the assistant's training examples: a designer that makes up a different game
 * every time (genre, layout, rules, extras, looks, wording), splits it into the parts the
 * assistant builds one by one, and writes each part's steps with real positions. Layouts are
 * made here (stairs, spirals, mazes, villages, tracks…) and the rules are real EasyScript. The
 * generator runs every part in the editor and keeps only games that work. Training only.
 */

export interface Rng {
  rand(): number;
  pick<T>(a: readonly T[]): T;
  int(a: number, b: number): number;
  chance(p: number): boolean;
}

export interface GamePart {
  text: string;
  reply: string;
  steps: Step[];
}

export interface Game {
  kind: string;
  flat: boolean;
  ask: string;
  summary: string;
  parts: GamePart[];
  /** What a designer would note before planning (the Think step). */
  notes: string;
  /** Asked vaguely first: the questions, and the answers that lead to this game. */
  vague?: { ask: string; questions: { q: string; options: string[] }[]; answers: string };
}

type V3 = [number, number, number];
const r1 = (v: number) => Math.round(v * 10) / 10;
const v3 = (x: number, y: number, z: number): V3 => [r1(x), r1(y), r1(z)];
const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

const COLORS = {
  red: '#d9452f', orange: '#f28c28', yellow: '#f2c23a', green: '#4fae3c', teal: '#2fa3a0', blue: '#3a6ee0', purple: '#8a4fd0',
  pink: '#f07ab0', white: '#eeeeee', grey: '#8a8a8a', dark: '#2a2a33', brown: '#8a5a34', stone: '#9a968c', wood: '#a0703c', sand: '#e0c890',
};
type ColorName = keyof typeof COLORS;
const BRIGHT: ColorName[] = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

// ── wording ─────────────────────────────────────────────────────────────────

/** How people start a request. */
const OPENERS = ['', '', 'make ', 'make me ', 'build ', 'can you make ', 'i want ', 'create ', 'please make ', 'I want to make ', 'lets make ', 'build me '];
const ENDS = ['', '', '', ' please', ' pls', '!', ' thanks', ' that is fun to play'];

/** A typo or two, the way people type fast. */
function typo(r: Rng, s: string): string {
  const words = s.split(' ');
  for (let k = r.int(1, 2); k > 0; k--) {
    const i = r.int(0, words.length - 1);
    const w = words[i];
    if (w.length < 4) continue;
    const j = r.int(1, w.length - 2);
    words[i] = r.chance(0.5) ? w.slice(0, j) + w.slice(j + 1) : w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2);
  }
  return words.join(' ');
}

/** The request in someone's words: an opener, the idea, the details they mention, an ending. */
function say(r: Rng, idea: string, details: string[]): string {
  const opener = r.pick(OPENERS);
  const listed = details.length ? (r.chance(0.5) ? ` with ${join(details)}` : `. ${details.map(cap).join('. ')}`) : '';
  let s = `${opener}${opener ? idea : cap(idea)}${listed}${r.pick(ENDS)}`;
  if (r.chance(0.3)) s = s.toLowerCase();
  if (r.chance(0.12)) s = typo(r, s);
  return s;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const join = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── rules (EasyScript) ──────────────────────────────────────────────────────

const S = {
  /** A score on screen and a win message when it reaches the goal. */
  scoreGoal: (goal: number, label: string, win: string) =>
    `{ on: { start: [ { set: "game.won", to: false } ], update: [ { hud: "${label}: {game.score} / ${goal}" }, { if: "game.score >= ${goal} and !game.won", then: [ { set: "game.won", to: true }, { say: "${win}", time: 5 } ] } ] } }`,
  /** Counts down; at zero the game starts again. */
  countdown: (seconds: number) =>
    `{ on: { start: [ { set: "game.timeLeft", to: ${seconds} } ], update: [ { hud: "Time: {game.timeLeft}" } ], timer: [ { every: 1, do: [ { if: "game.timeLeft > 0", then: [ { subtract: "game.timeLeft", value: 1 } ] }, { if: "game.timeLeft == 0 and !game.won", then: [ { say: "Time's up!", time: 3 }, { wait: 3 }, { restart: true } ] } ] } ] } }`,
  /** Counts down; reaching zero wins (survive). */
  survive: (seconds: number) =>
    `{ on: { start: [ { set: "game.timeLeft", to: ${seconds} }, { set: "game.won", to: false } ], update: [ { hud: "Survive: {game.timeLeft}" } ], timer: [ { every: 1, do: [ { if: "game.timeLeft > 0", then: [ { subtract: "game.timeLeft", value: 1 } ] }, { if: "game.timeLeft == 0 and !game.won", then: [ { set: "game.won", to: true }, { say: "You survived!", time: 5 } ] } ] } ] } }`,
  /** Counts up until the race is over. */
  stopwatch: () =>
    `{ on: { start: [ { set: "game.raceTime", to: 0 }, { set: "game.gate", to: 0 }, { set: "game.finished", to: false } ], update: [ { hud: "Time: {game.raceTime} s   Gates: {game.gate}" } ], timer: [ { every: 1, do: [ { if: "!game.finished", then: [ { add: "game.raceTime", value: 1 } ] } ] } ] } }`,
  /** A race gate: counts only in order. */
  gate: (k: number, total: number) =>
    `{ on: { touch: [ { if: "other.is('player') and game.gate == ${k - 1}" }, { set: "game.gate", to: ${k} }, { say: "Gate ${k} / ${total}", time: 1.5 } ] } }`,
  finishLine: (total: number) =>
    `{ on: { touch: [ { if: "other.is('player') and !game.finished" }, { if: "game.gate >= ${total}", then: [ { set: "game.finished", to: true }, { say: "Finished in {game.raceTime} seconds!", time: 6 } ], else: [ { say: "Go through all ${total} gates first!", time: 2 } ] } ] } }`,
  /** A key: picked up on touch. */
  key: (total: number, word: string) =>
    `{ on: { touch: [ { if: "other.is('player')" }, { add: "game.keys", value: 1 }, { say: "You found a ${word}! ({game.keys} / ${total})", time: 2 }, { destroy: "self" } ] } }`,
  /** A locked door: opens when the player has enough keys. */
  lockedDoor: (total: number, word: string) =>
    `{ on: { start: [ { set: "game.keys", to: 0 } ], near: [ { distance: 3, do: [ { if: "game.keys >= ${total}", then: [ { say: "The door opens!", time: 2 }, { hide: "self" } ], else: [ { say: "Locked. Find ${total} ${word}s.", time: 2 } ] } ] } ] } }`,
  /** Someone to talk to. */
  talk: (line: string) => `{ on: { near: [ { distance: 3, do: [ { dialog: "${line}", speaker: "self.name" } ] } ] } }`,
  /** A quest giver: asks for an item, thanks you when you bring it. */
  quest: (ask: string, thanks: string) =>
    `{ on: { start: [ { set: "game.hasItem", to: false }, { set: "game.questDone", to: false } ], near: [ { distance: 3, do: [ { if: "game.hasItem and !game.questDone", then: [ { set: "game.questDone", to: true }, { add: "game.score", value: 10 }, { dialog: "${thanks}", speaker: "self.name" } ], else: [ { if: "!game.questDone", then: [ { dialog: "${ask}", speaker: "self.name" } ] } ] } ] } ] } }`,
  questItem: (name: string) => `{ on: { touch: [ { if: "other.is('player')" }, { set: "game.hasItem", to: true }, { say: "You found the ${name}! Bring it back.", time: 3 }, { destroy: "self" } ] } }`,
  /** A treasure that wins the game. */
  treasure: (msg: string) => `{ on: { touch: [ { if: "other.is('player') and !game.won" }, { set: "game.won", to: true }, { say: "${msg}", time: 5 } ] } }`,
  /** A target: click it to score. */
  target: () => `{ on: { click: [ { add: "game.score", value: 1 }, { destroy: "self" } ] } }`,
  /** Makes copies of a hidden enemy every few seconds. */
  spawner: (template: string, every: number, max: number) =>
    `{ on: { start: [ { hide: "${template}" }, { set: "game.spawned", to: 0 } ], timer: [ { every: ${every}, do: [ { if: "game.spawned < ${max}" }, { spawn: "${template}", at: "self.position" }, { add: "game.spawned", value: 1 } ] } ] } }`,
  /** A pressure plate: opens the gate when the crate is pushed onto it. */
  plate: (crate: string, gate: string) =>
    `{ on: { touch: [ { if: "other.name == '${crate}'" }, { send: "open", to: "${gate}" }, { say: "Click! Something opened.", time: 2 } ] } }`,
  gateOpens: (rise: number) => `{ on: { message: { open: [ { move: [0, ${rise}, 0], time: 1.5 } ] } } }`,
  switchOpens: (gate: string) => `{ on: { key: { e: [ { send: "open", to: "${gate}" }, { say: "The gate opens!", time: 2 } ] } } }`,
  /** A goal for a ball game. */
  goal: (ball: string) =>
    `{ on: { touch: [ { if: "other.name == '${ball}'" }, { add: "game.score", value: 1 }, { say: "Goal!", time: 2 }, { send: "reset", to: "${ball}" } ] } }`,
  ballReset: (at: V3) => `{ on: { message: { reset: [ { moveTo: [${at.join(', ')}], time: 0 } ] } } }`,
  /** Where a carried package is dropped off. */
  dropZone: (thing: string) =>
    `{ on: { touch: [ { if: "other.name == '${thing}'" }, { add: "game.score", value: 1 }, { say: "Delivered!", time: 2 }, { destroy: "other" } ] } }`,
  /** Says something when the game starts (a goal for the player). */
  intro: (text: string) => `{ on: { start: [ { wait: 1 }, { say: "${text}", time: 5 } ] } }`,
  /** Chases the player when close. */
  chaser: (stopAt: number) => `{ on: { update: [ { chase: "player", stopAt: ${stopAt} } ] } }`,
};

/** Every rule this file writes, for a compile check before generating. */
export const SAMPLE_SCRIPTS = [
  S.scoreGoal(5, 'Coins', 'You win!'), S.countdown(60), S.survive(45), S.stopwatch(), S.gate(2, 6), S.finishLine(6), S.key(3, 'key'), S.lockedDoor(3, 'key'),
  S.talk('Hello!'), S.quest('Find my ring.', 'Thank you!'), S.questItem('ring'), S.treasure('You found the treasure!'), S.target(), S.spawner('Enemy', 5, 10),
  S.plate('Crate', 'Gate'), S.gateOpens(4), S.switchOpens('Gate'), S.goal('Ball'), S.ballReset([0, 1, 0]), S.dropZone('Package'), S.intro('Find the exit!'), S.chaser(1.2),
];

// ── building blocks ─────────────────────────────────────────────────────────

const create = (what: Step['what'], o: Partial<Step> = {}): Step => ({ do: 'create', what, ...o });
const script = (object: string, code: string): Step => ({ do: 'script', object, code });
const traits = (object: string, t: string[]): Step => ({ do: 'traits', object, traits: t });

/** An empty object that holds a game rule. */
const manager = (name: string, code: string, at: V3 = [0, 0, 0]): Step[] => [create('empty', { name, at }), script(name, code)];

interface Spot {
  name: string;
  at: V3;
  size: V3;
}
const top = (s: Spot, up = 0) => v3(s.at[0], s.at[1] + s.size[1] / 2 + up, s.at[2]);

const LOOKS_3D = ['Realistic', 'Cartoon', 'Retro'] as const;

/** Sky and light for a time of day (3D). */
function timeOfDay(r: Rng, when: 'day' | 'sunset' | 'night'): GamePart {
  if (when === 'night')
    return {
      text: r.pick(['Make it night: dark and a little foggy', 'A night sky with fog', 'Night time, dark with fog']),
      reply: 'It is night now.',
      steps: [create('sky'), create('fog'), { do: 'settings', field: 'exposure', value: '0.45' }, { do: 'settings', field: 'background', value: '#0b1020' }],
    };
  if (when === 'sunset')
    return { text: r.pick(['A warm sunset sky', 'Make it sunset', 'An orange evening sky']), reply: 'A warm sunset.', steps: [create('sky'), { do: 'settings', field: 'background', value: '#f0a060' }, { do: 'settings', field: 'exposure', value: '0.9' }] };
  return { text: r.pick(['A bright sunny sky', 'A blue sky', 'Sunny daytime sky']), reply: 'A sunny sky.', steps: [create('sky'), { do: 'settings', field: 'exposure', value: '1.1' }] };
}
const lookPart = (r: Rng, look: string): GamePart => ({
  text: r.pick([`Give it a ${look.toLowerCase()} look`, `Make it look ${look.toLowerCase()}`, `${look} look`]),
  reply: `It looks ${look.toLowerCase()} now.`,
  steps: [{ do: 'look', look }],
});

// ── the games (3D) ──────────────────────────────────────────────────────────

/** Obby: platforms to jump across in a line, a zigzag, a spiral or a curve, with extras. */
function obby(r: Rng): Game {
  const shape = r.pick(['straight', 'zigzag', 'spiral', 'curve'] as const);
  const n = r.int(6, 14);
  const rise = r.pick([0, 0.5, 0.8, 1, 1]);
  const gap = r.pick([1.5, 2, 2.5]);
  const color = r.pick(BRIGHT);
  const name = r.pick(['Step', 'Platform', 'Block', 'Jump']);
  const lava = r.chance(0.45);
  const startY = lava ? 1.5 : 0.25;
  const start: Spot = { name: 'Start', at: v3(0, startY, 0), size: [4, 0.5, 4] };
  const spots: Spot[] = [];
  const size: V3 = r.pick([[3, 0.5, 3], [2.5, 0.5, 2.5], [3, 0.5, 2], [2, 0.5, 2]]);
  const radius = r.int(7, 10);
  for (let i = 1; i <= n; i++) {
    const y = startY + rise * i;
    let at: V3;
    if (shape === 'straight') at = v3(0, y, -i * (size[2] + gap));
    else if (shape === 'zigzag') at = v3(i % 2 ? 2.5 : -2.5, y, -i * (size[2] + gap - 0.5));
    else if (shape === 'spiral') {
      const a = (i / n) * Math.PI * r.pick([1.5, 2]);
      at = v3(Math.sin(a) * radius, y, -radius + Math.cos(a) * radius);
    } else {
      const a = (i / n) * Math.PI * 0.8;
      at = v3(Math.sin(a) * radius * 1.5, y, -Math.sin(a * 0.9) * radius * 1.5 - i * 1.2);
    }
    spots.push({ name: `${name} ${i}`, at, size });
  }
  const last = spots[spots.length - 1];
  const extras: string[] = [];
  const parts: GamePart[] = [];
  parts.push({
    text: r.pick(['A start platform with the player on it', 'The player on a start platform', 'A player at the start']),
    reply: 'The player is on the start platform.',
    steps: [create('platform', { name: 'Start', at: start.at, size: start.size, color: COLORS.grey }), create('player', { at: top(start, 1) })],
  });
  const shapeWords = { straight: 'in a line going forward', zigzag: 'in a zigzag', spiral: 'in a spiral', curve: 'along a curve' }[shape];
  const platformSteps: Step[] =
    shape === 'straight'
      ? [{ do: 'row', what: 'platform', name, count: n, at: spots[0].at, step: v3(0, rise, -(size[2] + gap)), size, color: COLORS[color] }]
      : spots.map((s) => create('platform', { name: s.name, at: s.at, size, color: COLORS[color] }));
  parts.push({
    text: `${n} ${color} platforms ${shapeWords}${rise ? ', each a bit higher' : ''}, with ${gap} m gaps to jump`,
    reply: `Added ${n} platforms ${shapeWords}.`,
    steps: platformSteps,
  });
  if (r.chance(0.6)) {
    extras.push('coins');
    const on = spots.filter((_, i) => i % r.pick([1, 2]) === 0);
    parts.push({ text: r.pick([`A coin above ${on.length === n ? 'each' : 'every other'} platform`, `Coins over the platforms`]), reply: `Added ${on.length} coins.`, steps: on.map((s, i) => create('coin', { name: `Coin ${i + 1}`, at: top(s, 1) })) });
  }
  if (n >= 8 && r.chance(0.6)) {
    extras.push('checkpoints');
    const every = r.pick([3, 4]);
    const cps = spots.filter((_, i) => (i + 1) % every === 0 && i < n - 1);
    parts.push({ text: `Checkpoints on every ${every === 3 ? 'third' : 'fourth'} platform`, reply: `Made ${plural(cps.length, 'checkpoint')}.`, steps: cps.map((s) => traits(s.name, ['checkpoint'])) });
  }
  if (r.chance(0.4)) {
    extras.push('moving platforms');
    const which = spots.filter((_, i) => i > 0 && i < n - 1 && i % 3 === 1).slice(0, 3);
    parts.push({ text: `Make ${join(which.map((s) => s.name))} move back and forth`, reply: 'Those platforms move now.', steps: which.map((s) => traits(s.name, ['moving-platform'])) });
  } else if (r.chance(0.3)) {
    extras.push('platforms that vanish');
    const which = spots.filter((_, i) => i % 4 === 2).slice(0, 3);
    parts.push({ text: `${join(which.map((s) => s.name))} disappear after you step on them`, reply: 'Those platforms vanish when stood on.', steps: which.map((s) => traits(s.name, ['disappearing'])) });
  }
  if (r.chance(0.3)) {
    extras.push('a jump pad');
    const k = Math.min(n - 2, r.int(2, 4));
    const s = spots[k];
    parts.push({ text: `A jump pad on ${s.name}`, reply: `A jump pad on ${s.name}.`, steps: [create('cube', { name: 'Jump Pad', at: top(s, 0.1), size: [1.2, 0.2, 1.2], color: COLORS.green, traits: ['jump-pad'] })] });
  }
  if (lava) {
    extras.push('lava');
    const mid = spots[Math.floor(n / 2)].at;
    parts.push({
      text: r.pick(['A lava floor under everything that sends you back', 'Deadly lava below the platforms', 'Red lava under the course']),
      reply: 'Lava below: falling sends you back.',
      steps: [create('cube', { name: 'Lava', at: v3(mid[0], 0.1, mid[2]), size: [60, 0.2, 70], color: '#e0401a', traits: ['deadly'] })],
    });
  }
  parts.push({ text: `A finish on ${last.name}`, reply: 'The finish is on the last platform.', steps: [create('finish', { name: 'Finish', at: top(last, 0.1) })] });
  if (r.chance(0.35)) parts.push(timeOfDay(r, r.pick(['day', 'sunset', 'night'])));
  if (r.chance(0.3)) parts.push(lookPart(r, r.pick(LOOKS_3D)));
  const idea = r.pick([`an obby`, `a parkour level`, `an obby with ${n} platforms`, `a ${shape} obby`, `a jumping course`, `an obby where you jump ${shapeWords}`]);
  return {
    kind: 'game-obby',
    flat: false,
    ask: say(r, idea, r.chance(0.6) ? extras.slice(0, 3) : []),
    summary: `An obby: ${n} platforms ${shapeWords} to a finish${extras.length ? `, with ${join(extras)}` : ''}`,
    parts,
    notes: `Platforms ${shapeWords}, ${gap} m apart${rise ? ` and ${rise} m higher each` : ''}, about [${size.join(', ')}]. Player on a start platform, finish on the last one.${lava ? ' Lava under the course so falling sends you back.' : ''}`,
  };
}

/** Find the coins (or gems…) around a place, with a score and maybe a timer. */
function coinHunt(r: Rng): Game {
  const item = r.pick(['coin', 'coin', 'gem', 'star', 'crystal']);
  const n = r.int(8, 25);
  const land = r.pick(['flat', 'hills', 'valley', 'island'] as const);
  const area = r.int(30, 50);
  const parts: GamePart[] = [];
  if (land !== 'flat')
    parts.push({ text: `Shape the ground into ${land === 'island' ? 'an island' : land === 'valley' ? 'a valley' : 'rolling hills'}`, reply: `The ground is ${land} now.`, steps: [create('terrain', { name: 'Land' }), { do: 'set', object: 'Land', component: 'Terrain', field: 'preset', value: land }] });
  if (land === 'island') parts.push({ text: 'The sea around the island', reply: 'Water all around.', steps: [create('water', { name: 'Sea', at: [0, -0.5, 0], size: [260, 2, 260] })] });
  if (land !== 'flat' && r.chance(0.7))
    parts.push({ text: r.pick(['Trees and rocks around', 'Some trees on the land', 'Trees, bushes and rocks']), reply: 'Planted trees.', steps: [create('plants', { name: 'Trees', count: r.int(60, 200) }), ...(r.chance(0.5) ? [create('plants', { name: 'Rocks', count: r.int(30, 80) })] : [])] });
  else if (r.chance(0.6)) parts.push({ text: 'Some cubes and walls to hide things behind', reply: 'Added hiding spots.', steps: [{ do: 'scatter', what: 'cube', count: r.int(8, 15), at: [0, 0, 0], area: [area, area], size: [2, 2, 2], color: COLORS.stone }] });
  const itemColor = item === 'gem' ? COLORS.purple : item === 'crystal' ? COLORS.teal : item === 'star' ? COLORS.yellow : undefined;
  parts.push({ text: `${n} ${item}s hidden around the ${land === 'island' ? 'island' : 'area'}`, reply: `Hid ${n} ${item}s.`, steps: [{ do: 'scatter', what: 'coin', name: cap(item), count: n, at: [0, 1, 0], area: [area * 0.8, area * 0.8], ...(itemColor ? { color: itemColor } : {}) }] });
  parts.push({ text: `A player in the middle`, reply: 'The player starts in the middle.', steps: [create('player', { at: [0, 1, 0] })] });
  parts.push({ text: `The ${item}s found on screen, and you win when you have all ${n}`, reply: `Score on screen; ${n} wins.`, steps: manager('Game', S.scoreGoal(n, `${cap(item)}s`, `You found all the ${item}s!`)) });
  const timed = r.chance(0.4);
  const secs = r.pick([60, 90, 120]);
  if (timed) parts.push({ text: `A ${secs} second timer: when it runs out the game starts again`, reply: `${secs} seconds on the clock.`, steps: manager('Timer', S.countdown(secs)) });
  if (r.chance(0.4)) parts.push(timeOfDay(r, r.pick(['day', 'sunset'])));
  return {
    kind: 'game-collect',
    flat: false,
    ask: say(r, r.pick([`a ${item} hunt`, `a game where you collect ${item}s`, `find all the ${item}s`, `a ${item} collecting game${land === 'island' ? ' on an island' : ''}`]), [timed ? `a ${secs} second timer` : '', land !== 'flat' ? `${land}` : ''].filter(Boolean)),
    summary: `Collect all ${n} ${item}s${land !== 'flat' ? ` on ${land === 'island' ? 'an island' : land}` : ''}${timed ? ` within ${secs} seconds` : ''}`,
    parts,
    notes: `${n} ${item}s spread over the area, a score that wins at ${n}${timed ? `, a ${secs} s countdown` : ''}. Player in the middle.`,
  };
}

/** A maze made fresh every time (depth-first), with an exit and maybe keys or a monster. */
function maze(r: Rng): Game {
  const w = r.int(4, 5);
  const h = r.int(4, 5);
  const cell = r.pick([4, 5]);
  const wallH = 3;
  // Walls between cells: right[x][y], down[x][y] (true = wall).
  const right = [...Array(w)].map(() => Array(h).fill(true));
  const down = [...Array(w)].map(() => Array(h).fill(true));
  const seen = [...Array(w)].map(() => Array(h).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => [x + dx, y + dy] as const).filter(([a, b]) => a >= 0 && b >= 0 && a < w && b < h && !seen[a][b]);
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [a, b] = r.pick(next);
    if (a > x) right[x][y] = false;
    if (a < x) right[a][y] = false;
    if (b > y) down[x][y] = false;
    if (b < y) down[x][b] = false;
    seen[a][b] = true;
    stack.push([a, b]);
  }
  const ox = (-w * cell) / 2;
  const oz = (-h * cell) / 2;
  const wall = (name: string, x0: number, z0: number, x1: number, z1: number): Step => {
    const len = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) + 0.5;
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    return create('cube', { name, at: v3((x0 + x1) / 2, wallH / 2, (z0 + z1) / 2), size: along ? v3(len, wallH, 0.5) : v3(0.5, wallH, len), color: COLORS.stone });
  };
  // Inner walls, joined into long runs.
  const inner: Step[] = [];
  let k = 0;
  for (let x = 0; x < w - 1; x++) {
    let runStart = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && right[x][y];
      if (on && runStart < 0) runStart = y;
      if (!on && runStart >= 0) {
        inner.push(wall(`Wall ${++k}`, ox + (x + 1) * cell, oz + runStart * cell, ox + (x + 1) * cell, oz + y * cell));
        runStart = -1;
      }
    }
  }
  for (let y = 0; y < h - 1; y++) {
    let runStart = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && down[x][y];
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        inner.push(wall(`Wall ${++k}`, ox + runStart * cell, oz + (y + 1) * cell, ox + x * cell, oz + (y + 1) * cell));
        runStart = -1;
      }
    }
  }
  const W = w * cell;
  const H = h * cell;
  // Outer walls with an entrance (front left) and an exit (back right).
  const outer: Step[] = [
    wall('Outer Wall Left', ox, oz, ox, oz + H),
    wall('Outer Wall Right', ox + W, oz, ox + W, oz + H),
    wall('Outer Wall Front', ox + cell, oz + H, ox + W, oz + H),
    wall('Outer Wall Back', ox, oz, ox + W - cell, oz),
  ];
  const horror = r.chance(0.35);
  const keys = r.chance(0.4) ? r.int(2, 3) : 0;
  const monster = r.chance(horror ? 0.8 : 0.3);
  const parts: GamePart[] = [];
  parts.push({ text: `The outer walls of a ${w * cell} by ${h * cell} m maze, with an entrance and an exit`, reply: 'Built the outer walls.', steps: outer });
  parts.push({ text: 'The inner walls of the maze, making paths and dead ends', reply: `Built ${inner.length} inner walls.`, steps: inner });
  const entrance = v3(ox + cell / 2, 1, oz + H + 2);
  const exit = v3(ox + W - cell / 2, 0.1, oz - 2);
  parts.push({ text: 'A player at the maze entrance', reply: 'The player is at the entrance.', steps: [create('player', { at: entrance })] });
  const word = r.pick(['key', 'key', 'gem', 'orb']);
  if (keys) {
    const spots = [...Array(keys)].map(() => v3(ox + (r.int(0, w - 1) + 0.5) * cell, 1, oz + (r.int(0, h - 2) + 0.5) * cell));
    parts.push({ text: `${keys} ${word}s hidden in the maze`, reply: `Hid ${keys} ${word}s.`, steps: spots.flatMap((at, i) => [create('torus', { name: `${cap(word)} ${i + 1}`, at, size: [0.6, 0.6, 0.6], color: COLORS.yellow, traits: ['spinning', 'trigger'] }), script(`${cap(word)} ${i + 1}`, S.key(keys, word))]) });
    parts.push({ text: `A locked door at the exit that opens with all ${keys} ${word}s`, reply: 'The exit door is locked until you have them all.', steps: [create('cube', { name: 'Exit Door', at: v3(ox + W - cell / 2, 1.5, oz), size: [cell - 0.5, 3, 0.4], color: COLORS.wood }), script('Exit Door', S.lockedDoor(keys, word))] });
  }
  parts.push({ text: 'A finish just outside the exit', reply: 'The finish is past the exit.', steps: [create('finish', { name: 'Finish', at: exit })] });
  if (monster) {
    const at = v3(ox + (w / 2) * cell, 1, oz + (h / 2) * cell);
    parts.push({ text: r.pick(['A monster in the maze that chases you', 'An enemy that hunts the player in the maze']), reply: 'A monster roams the maze.', steps: [create('capsule', { name: 'Monster', at, size: [1, 1.4, 1], color: horror ? COLORS.dark : COLORS.red, traits: ['enemy'] })] });
  }
  if (horror) {
    parts.push(timeOfDay(r, 'night'));
    parts.push(lookPart(r, 'Horror'));
  } else if (r.chance(0.4)) parts.push(timeOfDay(r, r.pick(['day', 'sunset'])));
  if (r.chance(0.3)) parts.push({ text: `A ${r.pick([2, 3])} minute timer`, reply: 'A timer is running.', steps: manager('Timer', S.countdown(r.pick([120, 180]))) });
  const details = [keys ? `${keys} ${word}s to unlock the exit` : '', monster ? 'a monster chasing you' : ''].filter(Boolean);
  return {
    kind: 'game-maze',
    flat: false,
    ask: say(r, r.pick([horror ? 'a scary maze' : 'a maze game', 'a maze to escape', `a ${w}x${h} maze`, horror ? 'a horror maze at night' : 'a labyrinth']), details),
    summary: `Escape a ${horror ? 'dark ' : ''}maze${details.length ? ` with ${join(details)}` : ''}`,
    parts,
    notes: `A ${w * cell} x ${h * cell} m maze: outer walls with an entrance and an exit, inner walls in long runs (at most 60 new objects per part). Player at the entrance, finish past the exit.${keys ? ` ${keys} ${word}s and a locked exit door.` : ''}${monster ? ' An enemy inside.' : ''}`,
  };
}

/** Survive in an arena: enemies, waves, health pickups, a timer. */
function arena(r: Rng): Game {
  const round = r.chance(0.6);
  const R = r.int(12, 18);
  const segs = r.int(12, 16);
  const secs = r.pick([45, 60, 90]);
  const enemies = r.int(3, 6);
  const waves = r.chance(0.5);
  const parts: GamePart[] = [];
  const floorColor = r.pick(['stone', 'sand', 'grey'] as const);
  parts.push({ text: `A ${round ? 'round' : 'square'} arena floor ${R * 2} m across`, reply: 'Made the arena floor.', steps: [create(round ? 'cylinder' : 'cube', { name: 'Arena', at: [0, 0.25, 0], size: [R * 2, 0.5, R * 2], color: COLORS[floorColor], traits: ['solid'] })] });
  const len = ((2 * Math.PI * R) / segs) * 1.05;
  const walls = [...Array(segs)].map((_, i) => {
    const a = (i / segs) * Math.PI * 2;
    return create('cube', { name: `Arena Wall ${i + 1}`, at: v3(Math.sin(a) * R, 1.5, Math.cos(a) * R), rotate: [0, deg(a), 0], size: v3(len, 3, 0.6), color: COLORS.stone });
  });
  const square: Step[] = [
    create('cube', { name: 'Wall North', at: [0, 1.5, -R], size: [R * 2, 3, 0.6], color: COLORS.stone }),
    create('cube', { name: 'Wall South', at: [0, 1.5, R], size: [R * 2, 3, 0.6], color: COLORS.stone }),
    create('cube', { name: 'Wall East', at: [R, 1.5, 0], size: [0.6, 3, R * 2], color: COLORS.stone }),
    create('cube', { name: 'Wall West', at: [-R, 1.5, 0], size: [0.6, 3, R * 2], color: COLORS.stone }),
  ];
  parts.push({ text: 'Walls all around the arena', reply: 'Walled it in.', steps: round ? walls : square });
  parts.push({ text: 'The player in the middle, with health', reply: 'The player is in the middle.', steps: [create('player', { at: [0, 1.5, 0], traits: ['health'] })] });
  const foes: Step[] = [];
  for (let i = 0; i < enemies; i++) {
    const a = (i / enemies) * Math.PI * 2 + 0.3;
    foes.push(create('capsule', { name: `Enemy ${i + 1}`, at: v3(Math.sin(a) * (R - 3), 1.5, Math.cos(a) * (R - 3)), color: COLORS.red, traits: ['enemy', 'health'] }));
  }
  parts.push({ text: `${enemies} enemies around the edge that attack the player`, reply: `${enemies} enemies are waiting.`, steps: foes });
  if (waves) {
    const every = r.pick([4, 6, 8]);
    parts.push({ text: `More enemies keep coming: a new one every ${every} seconds`, reply: `A new enemy every ${every} s.`, steps: [create('capsule', { name: 'Enemy Template', at: [0, 1.5, -R + 2], color: COLORS.red, traits: ['enemy', 'health'] }), ...manager('Spawner', S.spawner('Enemy Template', every, 12), [0, 1, -R + 2])] });
  }
  if (r.chance(0.7)) {
    const k = r.int(2, 4);
    parts.push({ text: `${k} health pickups in the arena`, reply: `${k} health pickups.`, steps: [{ do: 'scatter', what: 'sphere', name: 'Health', count: k, at: [0, 1, 0], area: [R, R], size: [0.6, 0.6, 0.6], color: COLORS.green, traits: ['healing', 'floating'] }] });
  }
  parts.push({ text: `Survive for ${secs} seconds to win`, reply: `Survive ${secs} seconds.`, steps: manager('Game', S.survive(secs)) });
  if (r.chance(0.4)) parts.push(timeOfDay(r, r.pick(['day', 'sunset', 'night'])));
  if (r.chance(0.3)) parts.push(lookPart(r, r.pick(LOOKS_3D)));
  return {
    kind: 'game-arena',
    flat: false,
    ask: say(r, r.pick(['an arena survival game', 'survive the enemies', 'a battle arena', `an arena where you survive ${secs} seconds`, 'a game where enemies attack you']), waves ? ['waves of enemies'] : []),
    summary: `Survive ${secs} seconds in an arena with ${enemies} enemies${waves ? ' and more coming' : ''}`,
    parts,
    notes: `A ${round ? 'round' : 'square'} floor ${R * 2} m wide with walls, player with health in the middle, enemies at the edge, a ${secs} s survive timer.${waves ? ' A hidden enemy copied by a spawner.' : ''}`,
  };
}

/** A race through gates around a loop, timed. */
function race(r: Rng): Game {
  const a = r.int(28, 40);
  const b = r.int(16, 26);
  const n = r.int(6, 10);
  const pt = (t: number): V3 => v3(Math.sin(t) * a, 0, Math.cos(t) * b);
  const tangent = (t: number) => Math.atan2(Math.cos(t) * a, -Math.sin(t) * b);
  const parts: GamePart[] = [];
  const road = r.chance(0.6);
  if (road) {
    const segs = 16;
    parts.push({
      text: 'A road going around in a loop',
      reply: 'Laid a road around the loop.',
      steps: [...Array(segs)].map((_, i) => {
        const t = ((i + 0.5) / segs) * Math.PI * 2;
        const p = pt(t);
        const len = (Math.PI * (a + b)) / segs + 1;
        return create('cube', { name: `Road ${i + 1}`, at: v3(p[0], 0.05, p[2]), rotate: [0, deg(tangent(t)), 0], size: v3(6, 0.1, len), color: COLORS.dark });
      }),
    });
  }
  const gates = [...Array(n)].map((_, i) => {
    const t = ((i + 1) / (n + 1)) * Math.PI * 2;
    return { name: `Gate ${i + 1}`, at: v3(pt(t)[0], 2.5, pt(t)[2]), rot: deg(tangent(t)) };
  });
  const gateColor = r.pick(BRIGHT);
  parts.push({
    text: `${n} ${gateColor} gates around the loop to go through in order`,
    reply: `${n} gates around the track.`,
    steps: gates.flatMap((g, i) => [create('torus', { name: g.name, at: g.at, rotate: [0, g.rot, 0], size: [5, 5, 5], color: COLORS[gateColor], traits: ['trigger'] }), script(g.name, S.gate(i + 1, n))]),
  });
  const start = pt(0);
  parts.push({ text: 'A player at the start line', reply: 'The player is at the start.', steps: [create('player', { at: v3(start[0] - 2, 1, start[2]) })] });
  parts.push({ text: 'A finish line at the start that ends the race after all the gates', reply: 'The finish line checks every gate.', steps: [create('cube', { name: 'Finish Line', at: v3(start[0], 0.1, start[2] - 2), size: [8, 0.2, 1.5], color: COLORS.white, traits: ['trigger'] }), script('Finish Line', S.finishLine(n))] });
  parts.push({ text: 'A race clock on screen', reply: 'The clock shows your time.', steps: manager('Race', S.stopwatch()) });
  if (r.chance(0.5)) parts.push({ text: 'Cones along the inside of the track', reply: 'Added cones.', steps: [...Array(10)].map((_, i) => { const t = (i / 10) * Math.PI * 2; return create('cone', { name: `Cone ${i + 1}`, at: v3(Math.sin(t) * (a - 6), 0.5, Math.cos(t) * (b - 6)), size: [0.6, 1, 0.6], color: COLORS.orange }); }) });
  if (r.chance(0.4)) {
    const side = Math.round(1.6 / Math.sqrt(1 / (a - 7) ** 2 + 1 / (b - 7) ** 2));
    parts.push({ text: 'Trees in the middle of the loop', reply: 'Planted trees inside the loop.', steps: [create('plants', { name: 'Trees', at: [0, 0, 0], area: [side, side], count: r.int(20, 60) })] });
  }
  if (r.chance(0.4)) parts.push(timeOfDay(r, r.pick(['day', 'sunset'])));
  return {
    kind: 'game-race',
    flat: false,
    ask: say(r, r.pick(['a racing game', 'a race track', 'a time trial through gates', 'a race around a loop', `a race with ${n} checkpoints`]), road ? [] : ['gates to fly through']),
    summary: `A timed race through ${n} gates around a loop`,
    parts,
    notes: `An oval about ${a * 2} by ${b * 2} m. Gates (torus, trigger) along it, facing the way you run, each only counting in order. A clock and a finish line that checks all the gates.`,
  };
}

/** A village: houses around a square, a well, paths, people to talk to, maybe a quest. */
function village(r: Rng): Game {
  const n = r.int(4, 7);
  const R = r.int(12, 17);
  const parts: GamePart[] = [];
  const hills = r.chance(0.3);
  if (hills) parts.push({ text: 'Gentle hills for the village to sit in', reply: 'Shaped the ground into gentle hills.', steps: [create('terrain', { name: 'Land' }), { do: 'set', object: 'Land', component: 'Terrain', field: 'preset', value: 'valley' }] });
  const houses: Spot[] = [];
  const bodies: Step[] = [];
  const roofs: Step[] = [];
  const doors: Step[] = [];
  const roofColor = r.pick(['red', 'brown', 'dark', 'blue'] as const);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.rand() * 0.3;
    const wd = r.pick([4, 5, 6]);
    const ht = r.pick([3, 3.5, 4]);
    const at = v3(Math.sin(a) * R, ht / 2, Math.cos(a) * R);
    const name = `House ${i + 1}`;
    houses.push({ name, at, size: [wd, ht, wd] });
    bodies.push(create('cube', { name, at, rotate: [0, deg(a), 0], size: v3(wd, ht, wd), color: r.pick([COLORS.white, COLORS.sand, COLORS.wood, COLORS.stone]) }));
    roofs.push(create('cone', { name: `${name} Roof`, at: v3(at[0], ht + 1, at[2]), rotate: [0, deg(a) + 45, 0], size: v3(wd * 1.5, 2, wd * 1.5), color: COLORS[roofColor] }));
    const d = wd / 2 + 0.15;
    doors.push(create('cube', { name: `${name} Door`, at: v3(at[0] - Math.sin(a) * d, 1, at[2] - Math.cos(a) * d), rotate: [0, deg(a), 0], size: [1.2, 2, 0.2], color: COLORS.brown, traits: ['door'] }));
  }
  parts.push({ text: `${n} houses in a ring around a village square`, reply: `Built ${n} houses.`, steps: bodies });
  parts.push({ text: `A ${roofColor} roof on each house`, reply: 'Every house has a roof.', steps: roofs });
  if (r.chance(0.7)) parts.push({ text: 'A door on each house, facing the square, that opens with E', reply: 'Doors that open with E.', steps: doors });
  const centre = r.pick(['well', 'fountain', 'statue', 'big tree'] as const);
  parts.push({
    text: `A ${centre} in the middle of the square`,
    reply: `A ${centre} in the middle.`,
    steps:
      centre === 'well'
        ? [create('cylinder', { name: 'Well', at: [0, 0.6, 0], size: [2, 1.2, 2], color: COLORS.stone }), create('cone', { name: 'Well Roof', at: [0, 2.6, 0], size: [2.6, 1, 2.6], color: COLORS[roofColor] })]
        : centre === 'fountain'
          ? [create('cylinder', { name: 'Fountain', at: [0, 0.4, 0], size: [4, 0.8, 4], color: COLORS.stone }), create('cylinder', { name: 'Fountain Top', at: [0, 1.4, 0], size: [0.8, 1.5, 0.8], color: COLORS.stone })]
          : centre === 'statue'
            ? [create('cube', { name: 'Plinth', at: [0, 0.5, 0], size: [2, 1, 2], color: COLORS.stone }), create('capsule', { name: 'Statue', at: [0, 2, 0], color: COLORS.grey })]
            : [create('cylinder', { name: 'Big Tree Trunk', at: [0, 2, 0], size: [0.8, 4, 0.8], color: COLORS.brown }), create('sphere', { name: 'Big Tree Leaves', at: [0, 5, 0], size: [5, 4, 5], color: COLORS.green })],
  });
  if (r.chance(0.6))
    parts.push({
      text: 'Paths from the square to every house',
      reply: 'Paths to every house.',
      steps: houses.map((h, i) => {
        const a = Math.atan2(h.at[0], h.at[2]);
        const len = R - h.size[0] / 2 - 2;
        return create('cube', { name: `Path ${i + 1}`, at: v3(Math.sin(a) * (len / 2 + 2), 0.03, Math.cos(a) * (len / 2 + 2)), rotate: [0, deg(a), 0], size: v3(1.6, 0.05, len), color: COLORS.sand });
      }),
    });
  const people = r.int(1, 3);
  const NAMES = ['Mira', 'Tom', 'Old Ben', 'Lina', 'The Baker', 'Farmer Joe', 'Ava', 'Guard'];
  const LINES = ['Welcome to our village!', 'The forest is dangerous at night.', 'Have you seen my cat?', 'Lovely weather today.', 'The well is the oldest thing here.', 'I sell bread every morning.'];
  const who = [...Array(people)].map((_, i) => ({ name: NAMES[(i * 3 + r.int(0, 2)) % NAMES.length], at: v3(Math.sin(i * 2.1) * (R * 0.5), 1, Math.cos(i * 2.1) * (R * 0.5)) }));
  const unique = who.filter((p, i) => who.findIndex((q) => q.name === p.name) === i);
  parts.push({
    text: `${plural(unique.length, 'villager')} you can talk to`,
    reply: `${join(unique.map((p) => p.name))} ${unique.length === 1 ? 'talks' : 'talk'} to you.`,
    steps: unique.flatMap((p) => [create('capsule', { name: p.name, at: p.at, color: r.pick(BRIGHT.map((c) => COLORS[c])), traits: r.chance(0.4) ? ['patrolling'] : [] }), script(p.name, S.talk(r.pick(LINES)))]),
  });
  const quest = r.chance(0.6);
  const item = r.pick(['ring', 'lost cat', 'golden key', 'old map', 'basket']);
  if (quest) {
    const giver = unique[0].name;
    const far = v3(r.pick([-1, 1]) * (R + r.int(8, 14)), 0.6, r.pick([-1, 1]) * (R + r.int(4, 10)));
    parts.push({ text: `A quest: ${giver} asks you to find the ${item}`, reply: `${giver} has a quest now.`, steps: [script(giver, S.quest(`Please find my ${item}! I lost it outside the village.`, `My ${item}! Thank you so much!`))] });
    parts.push({ text: `The ${item} hidden outside the village`, reply: `The ${item} is out there somewhere.`, steps: [create(item === 'lost cat' ? 'capsule' : 'torus', { name: cap(item), at: far, size: [0.6, 0.6, 0.6], color: COLORS.yellow, traits: ['floating', 'trigger'] }), script(cap(item), S.questItem(item))] });
  }
  parts.push({ text: 'A player in the square', reply: 'The player starts in the square.', steps: [create('player', { at: [3, 1, 3] })] });
  if (r.chance(0.6)) {
    const d = R + 14;
    parts.push({ text: 'Woods around the outside of the village', reply: 'Trees around the village.', steps: ([[d, d], [-d, d], [d, -d], [-d, -d]] as const).map(([x, z], i) => create('plants', { name: `Trees ${i + 1}`, at: [x, 0, z], area: [18, 18], count: r.int(15, 40) })) });
  }
  if (r.chance(0.5)) parts.push({ text: 'Lamps along the paths', reply: 'Lamps light the paths.', steps: houses.slice(0, 5).map((h, i) => create('light', { name: `Lamp ${i + 1}`, at: v3(h.at[0] * 0.55, 3, h.at[2] * 0.55) })) });
  if (r.chance(0.5)) parts.push(timeOfDay(r, r.pick(['day', 'sunset', 'night'])));
  if (r.chance(0.3)) parts.push(lookPart(r, r.pick(['Cartoon', 'Realistic'])));
  return {
    kind: 'game-village',
    flat: false,
    ask: say(r, r.pick(['a village', 'a small town with people', 'an RPG village', `a village with ${n} houses`, 'a cozy village to explore']), [quest ? `a quest to find the ${item}` : '', 'people to talk to', centre === 'well' ? 'a well' : ''].filter(Boolean)),
    summary: `A village of ${n} houses around a square${quest ? `, with a quest to find the ${item}` : ''}`,
    parts,
    notes: `Houses in a ring (radius ${R}) facing the square, roofs on top, doors facing in. Villagers with dialog.${quest ? ` One gives a quest; the ${item} sits outside the village.` : ''}`,
  };
}

/** Escape a dark house: rooms, keys, a locked exit, a monster. */
function horrorHouse(r: Rng): Game {
  const W = r.int(16, 22);
  const D = r.int(14, 20);
  const keys = r.int(2, 4);
  const word = r.pick(['key', 'fuse', 'page', 'candle']);
  const hx = W / 2;
  const hz = D / 2;
  const wall = (name: string, at: V3, size: V3): Step => create('cube', { name, at, size, color: '#4a4540' });
  const parts: GamePart[] = [];
  parts.push({ text: 'Make it dark night with fog', reply: 'Dark and foggy.', steps: [create('fog'), { do: 'settings', field: 'exposure', value: '0.3' }, { do: 'settings', field: 'background', value: '#050608' }] });
  parts.push({ text: `The outside walls of an old house, ${W} by ${D} m, with a front door gap`, reply: 'Built the outside walls.', steps: [
    wall('Back Wall', [0, 1.5, -hz], [W, 3, 0.4]),
    wall('Left Wall', [-hx, 1.5, 0], [0.4, 3, D]),
    wall('Right Wall', [hx, 1.5, 0], [0.4, 3, D]),
    wall('Front Wall Left', v3(-hx / 2 - 1, 1.5, hz), v3(hx - 2, 3, 0.4)),
    wall('Front Wall Right', v3(hx / 2 + 1, 1.5, hz), v3(hx - 2, 3, 0.4)),
    create('cube', { name: 'Floor', at: [0, 0.05, 0], size: [W, 0.1, D], color: '#3a2e24' }),
  ] });
  parts.push({ text: 'Inside walls splitting it into four rooms with doorways', reply: 'Four rooms with doorways.', steps: [
    wall('Middle Wall A', v3(-hx / 2 - 1, 1.5, 0), v3(hx - 2, 3, 0.3)),
    wall('Middle Wall B', v3(hx / 2 + 1, 1.5, 0), v3(hx - 2, 3, 0.3)),
    wall('Middle Wall C', v3(0, 1.5, -hz / 2 - 1), v3(0.3, 3, hz - 2)),
    wall('Middle Wall D', v3(0, 1.5, hz / 2 + 1), v3(0.3, 3, hz - 2)),
  ] });
  const rooms: V3[] = [v3(-hx / 2, 1, -hz / 2), v3(hx / 2, 1, -hz / 2), v3(-hx / 2, 1, hz / 2), v3(hx / 2, 1, hz / 2)];
  const spots = rooms.slice(0, keys).map((p) => v3(p[0] + r.int(-2, 2), 1, p[2] + r.int(-2, 2)));
  parts.push({ text: `${keys} ${word}s hidden in the rooms`, reply: `Hid ${keys} ${word}s.`, steps: spots.flatMap((at, i) => [create('cube', { name: `${cap(word)} ${i + 1}`, at, size: [0.4, 0.4, 0.4], color: COLORS.yellow, traits: ['floating', 'trigger'] }), script(`${cap(word)} ${i + 1}`, S.key(keys, word))]) });
  parts.push({ text: `The front door is locked until you find all ${keys} ${word}s`, reply: 'The front door is locked.', steps: [create('cube', { name: 'Front Door', at: v3(0, 1.5, hz), size: [4, 3, 0.3], color: COLORS.brown }), script('Front Door', S.lockedDoor(keys, word))] });
  parts.push({ text: 'A player starting in a back room', reply: 'The player wakes up in a back room.', steps: [create('player', { at: rooms[0] }), ...manager('Story', S.intro(`Find ${keys} ${word}s and get out!`))] });
  parts.push({ text: r.pick(['A monster that hunts you', 'A ghost that chases the player', 'Something in the dark that chases you']), reply: 'Something is hunting you.', steps: [create('capsule', { name: r.pick(['Monster', 'Ghost', 'The Thing']), at: rooms[3], size: [1, 1.5, 1], color: '#15151a', traits: ['enemy'] })] });
  parts.push({ text: 'A few dim lights in the rooms', reply: 'Dim lights in the rooms.', steps: rooms.slice(0, r.int(2, 4)).map((p, i) => create('light', { name: `Dim Light ${i + 1}`, at: v3(p[0], 2.6, p[2]), color: r.pick(['#ffb060', '#80a0ff', '#ff5040']) })) });
  parts.push({ text: 'Outside: a finish past the front door', reply: 'Escape out the front to win.', steps: [create('finish', { name: 'Escape', at: v3(0, 0.1, hz + 4) })] });
  parts.push(lookPart(r, 'Horror'));
  return {
    kind: 'game-horror',
    flat: false,
    ask: say(r, r.pick(['a horror game', 'a scary escape game', 'a haunted house to escape', 'a creepy house game', 'a horror game where you find keys']), [`find ${keys} ${word}s`, 'a monster'].filter(() => r.chance(0.6))),
    summary: `Escape a dark house: find ${keys} ${word}s while a monster hunts you`,
    parts,
    notes: `Dark (low exposure, fog). A ${W} x ${D} m house: outside walls with a front gap, four rooms, ${word}s in rooms, a locked front door that checks the count, a chasing enemy, dim lights, horror look.`,
  };
}

/** Explore an island and find the treasure. */
function island(r: Rng): Game {
  const parts: GamePart[] = [];
  parts.push({ text: 'Shape the ground into an island', reply: 'Made an island.', steps: [create('terrain', { name: 'Island' }), { do: 'set', object: 'Island', component: 'Terrain', field: 'preset', value: 'island' }] });
  parts.push({ text: 'The sea all around', reply: 'Water all around.', steps: [create('water', { name: 'Sea', at: [0, -0.5, 0], size: [260, 2, 260] })] });
  parts.push({ text: r.pick(['Palm trees and rocks on the island', 'Trees and bushes across the island']), reply: 'Planted the island.', steps: [create('plants', { name: 'Palm Trees', count: r.int(40, 120) }), create('plants', { name: 'Rocks', count: r.int(20, 60) })] });
  if (r.chance(0.6)) parts.push({ text: 'Grass on the island', reply: 'Grass grows now.', steps: [create('grass')] });
  const a = r.rand() * Math.PI * 2;
  const d = r.int(10, 25);
  const chest = v3(Math.sin(a) * d, 0, Math.cos(a) * d);
  parts.push({ text: 'A treasure chest hidden somewhere on the island', reply: 'The treasure is hidden.', steps: [create('cube', { name: 'Treasure Chest', at: chest, size: [1.2, 0.8, 0.8], color: COLORS.wood, traits: ['trigger'] }), script('Treasure Chest', S.treasure('You found the treasure!'))] });
  if (r.chance(0.5)) parts.push({ text: `Gold coins on the way, ${r.int(8, 15)} of them`, reply: 'Coins scattered around.', steps: [{ do: 'scatter', what: 'coin', name: 'Gold', count: r.int(8, 15), at: [0, 1, 0], area: [40, 40] }] });
  parts.push({ text: 'The player on the beach', reply: 'The player starts on the beach.', steps: [create('player', { at: v3(-Math.sin(a) * 30, 0, -Math.cos(a) * 30) }), ...manager('Story', S.intro('Find the treasure chest!'))] });
  parts.push(timeOfDay(r, r.pick(['day', 'day', 'sunset'])));
  if (r.chance(0.4)) parts.push(lookPart(r, r.pick(['Realistic', 'Cartoon'])));
  return {
    kind: 'game-island',
    flat: false,
    ask: say(r, r.pick(['a treasure island', 'an island to explore with treasure', 'a pirate island game', 'find the treasure on an island']), []),
    summary: 'Explore an island and find the hidden treasure',
    parts,
    notes: 'Terrain island preset with water around, plants on it, a chest with a script that wins, player on the beach (things at y 0 sit on the land).',
  };
}

/** A calm nature scene (no game). */
function nature(r: Rng): Game {
  const land = r.pick(['hills', 'mountains', 'valley', 'plateaus'] as const);
  const trees = r.pick(['pine trees', 'trees', 'birch trees', 'oak trees']);
  const parts: GamePart[] = [
    { text: `Shape the ground into ${land}`, reply: `The ground is ${land} now.`, steps: [create('terrain', { name: 'Land' }), { do: 'set', object: 'Land', component: 'Terrain', field: 'preset', value: land }] },
    { text: 'Grass over the land', reply: 'Grass everywhere.', steps: [create('grass')] },
    { text: `${cap(trees)} on the slopes`, reply: `Planted ${trees}.`, steps: [create('plants', { name: cap(trees), count: r.int(80, 300) })] },
  ];
  if (r.chance(0.6)) parts.push({ text: 'Wildflowers in the meadows', reply: 'Flowers in the meadows.', steps: [create('plants', { name: 'Wildflowers', count: r.int(100, 400) })] });
  if (r.chance(0.5)) parts.push({ text: 'Rocks scattered around', reply: 'Rocks here and there.', steps: [create('plants', { name: 'Rocks', count: r.int(20, 60) })] });
  if (land === 'valley' && r.chance(0.6)) parts.push({ text: 'A lake at the bottom of the valley', reply: 'A lake in the valley.', steps: [create('water', { name: 'Lake', at: [0, 0, 0], size: [36, 2, 36] })] });
  if (r.chance(0.6)) {
    const at = v3(r.int(-10, 10), 0, r.int(-10, 10));
    parts.push({ text: 'A small cabin', reply: 'A cabin.', steps: [create('cube', { name: 'Cabin', at: v3(at[0], 1.5, at[2]), size: [5, 3, 4], color: COLORS.wood }), create('cone', { name: 'Cabin Roof', at: v3(at[0], 4, at[2]), rotate: [0, 45, 0], size: [7, 2, 6], color: COLORS.brown })] });
  }
  parts.push(timeOfDay(r, r.pick(['day', 'sunset', 'night'])));
  if (r.chance(0.5)) parts.push({ text: 'A light haze in the distance', reply: 'A soft haze.', steps: [create('fog')] });
  if (r.chance(0.5)) parts.push({ text: 'A player to walk around', reply: 'You can walk around.', steps: [create('player', { at: [0, 0, 0] })] });
  if (r.chance(0.5)) parts.push(lookPart(r, 'Realistic'));
  return {
    kind: 'scene-nature',
    flat: false,
    ask: say(r, r.pick([`a ${land} landscape`, `a peaceful forest`, `a nature scene with ${trees}`, `${land} with ${trees} and a cabin`, `a beautiful outdoor scene`]), []),
    summary: `A ${land} landscape with ${trees}`,
    parts,
    notes: `Terrain (${land}), grass, ${trees} and other plants as Scatter, a sky; optional lake, cabin, fog, player.`,
  };
}

/** Climb a tower: platforms spiralling up around it, ladders, a prize at the top. */
function tower(r: Rng): Game {
  const H = r.int(15, 30);
  const R = r.int(5, 7);
  const n = Math.round(H / 1.3);
  const parts: GamePart[] = [{ text: `A tall stone tower, ${H} m high`, reply: 'A tall tower.', steps: [create('cylinder', { name: 'Tower', at: v3(0, H / 2, 0), size: v3(R * 2 - 2, H, R * 2 - 2), color: COLORS.stone })] }];
  const spots: Spot[] = [];
  for (let i = 0; i < n && spots.length < 24; i++) {
    const a = i * 0.7;
    spots.push({ name: `Ledge ${i + 1}`, at: v3(Math.sin(a) * R, 0.8 + i * 1.3, Math.cos(a) * R), size: [2.5, 0.4, 2.5] });
  }
  parts.push({ text: 'Ledges spiralling up around the tower', reply: `${spots.length} ledges up the tower.`, steps: spots.map((s) => create('platform', { name: s.name, at: s.at, size: s.size, color: COLORS.wood })) });
  const ladders = r.chance(0.5);
  if (ladders) {
    const k = Math.floor(spots.length / 2);
    parts.push({ text: `A ladder halfway up to skip ahead`, reply: 'A ladder halfway up.', steps: [create('cube', { name: 'Ladder', at: v3(spots[k].at[0] * 1.1, spots[k].at[1] + 2, spots[k].at[2] * 1.1), size: [1, 4, 0.2], color: COLORS.brown, traits: ['climbable'] })] });
  }
  if (r.chance(0.5)) parts.push({ text: 'Checkpoints every few ledges', reply: 'Checkpoints along the way.', steps: spots.filter((_, i) => i % 6 === 5).map((s) => traits(s.name, ['checkpoint'])) });
  parts.push({ text: 'The player at the bottom', reply: 'The player is at the bottom.', steps: [create('player', { at: v3(0, 1, R + 3) })] });
  parts.push({ text: 'A finish on top of the tower', reply: 'The finish is on top.', steps: [create('finish', { name: 'Top', at: v3(0, H + 0.1, 0) })] });
  if (r.chance(0.5)) parts.push(timeOfDay(r, r.pick(['day', 'sunset'])));
  return {
    kind: 'game-tower',
    flat: false,
    ask: say(r, r.pick(['a tower climb', 'a tall tower to climb', `climb a ${H} meter tower`, 'a tower obby']), ladders ? ['a ladder'] : []),
    summary: `Climb ledges around a ${H} m tower to the top`,
    parts,
    notes: `A cylinder tower ${H} m tall; ledges in a spiral ${R} m from the centre, 1.3 m higher each; finish on top.`,
  };
}

/** Click targets before the time runs out. */
function targets(r: Rng): Game {
  const n = r.int(8, 15);
  const secs = r.pick([30, 45, 60]);
  const parts: GamePart[] = [];
  const stands: Step[] = [];
  const pins: Step[] = [];
  for (let i = 0; i < n; i++) {
    const at = v3(r.int(-14, 14), r.int(1, 5), -r.int(8, 25));
    pins.push(create('cylinder', { name: `Target ${i + 1}`, at, rotate: [90, 0, 0], size: [1.2, 0.2, 1.2], color: COLORS.red }), script(`Target ${i + 1}`, S.target()));
    if (at[1] > 1.5) stands.push(create('cube', { name: `Stand ${i + 1}`, at: v3(at[0], (at[1] - 0.6) / 2, at[2] - 0.3), size: v3(0.3, at[1] - 0.6, 0.3), color: COLORS.wood }));
  }
  parts.push({ text: `${n} red targets at different distances and heights; clicking one scores`, reply: `${n} targets to hit.`, steps: pins });
  if (stands.length) parts.push({ text: 'Wooden stands under the high targets', reply: 'Stands under the targets.', steps: stands });
  parts.push({ text: 'The player at the front', reply: 'The player is at the front.', steps: [create('player', { at: [0, 1, 4] })] });
  parts.push({ text: `A score on screen, win when every target is hit`, reply: 'Score on screen.', steps: manager('Game', S.scoreGoal(n, 'Hits', 'All targets down!')) });
  parts.push({ text: `A ${secs} second timer`, reply: `${secs} seconds to hit them all.`, steps: manager('Timer', S.countdown(secs)) });
  if (r.chance(0.4)) parts.push(lookPart(r, r.pick(LOOKS_3D)));
  return {
    kind: 'game-targets',
    flat: false,
    ask: say(r, r.pick(['a target practice game', 'a shooting gallery', 'click the targets game', `hit ${n} targets in ${secs} seconds`]), []),
    summary: `Hit ${n} targets in ${secs} seconds`,
    parts,
    notes: 'Targets (thin cylinders turned to face the player) with a click script that adds score and removes them; score goal and countdown managers.',
  };
}

/** Push the crate onto the plate to open the gate. */
function puzzle(r: Rng): Game {
  const parts: GamePart[] = [];
  const z = -r.int(10, 16);
  parts.push({ text: 'A wall across the level with a gate in the middle', reply: 'A wall with a gate.', steps: [create('cube', { name: 'Wall Left', at: [-7, 2, z], size: [10, 4, 1], color: COLORS.stone }), create('cube', { name: 'Wall Right', at: [7, 2, z], size: [10, 4, 1], color: COLORS.stone }), create('cube', { name: 'Gate', at: [0, 2, z], size: [4, 4, 0.8], color: COLORS.dark }), script('Gate', S.gateOpens(4.5))] });
  const usePlate = r.chance(0.6);
  if (usePlate) {
    parts.push({ text: 'A crate you can push', reply: 'A pushable crate.', steps: [create('cube', { name: 'Crate', at: [r.int(-6, 6), 0.6, -2], size: [1.2, 1.2, 1.2], color: COLORS.wood, traits: ['pushable'] })] });
    parts.push({ text: 'A pressure plate that opens the gate when the crate is on it', reply: 'Push the crate onto the plate.', steps: [create('cube', { name: 'Pressure Plate', at: [r.pick([-5, 5]), 0.05, z + 5], size: [2, 0.1, 2], color: COLORS.yellow, traits: ['trigger'] }), script('Pressure Plate', S.plate('Crate', 'Gate'))] });
  } else parts.push({ text: 'A lever that opens the gate when you press E near it', reply: 'Press E at the lever.', steps: [create('cylinder', { name: 'Lever', at: [r.pick([-5, 5]), 0.6, z + 4], size: [0.3, 1.2, 0.3], color: COLORS.red }), script('Lever', S.switchOpens('Gate'))] });
  parts.push({ text: 'A finish behind the gate', reply: 'The finish is behind the gate.', steps: [create('finish', { name: 'Finish', at: [0, 0.1, z - 5] })] });
  parts.push({ text: 'The player at the start', reply: 'The player is at the start.', steps: [create('player', { at: [0, 1, 4] }), ...manager('Story', S.intro(usePlate ? 'Open the gate. Maybe that crate helps...' : 'Find a way to open the gate.'))] });
  if (r.chance(0.4)) parts.push(lookPart(r, r.pick(LOOKS_3D)));
  return {
    kind: 'game-puzzle',
    flat: false,
    ask: say(r, r.pick(['a puzzle game', 'a puzzle where you open a gate', usePlate ? 'push a box onto a button to open a door' : 'pull a lever to open a gate', 'a small puzzle level']), []),
    summary: usePlate ? 'Push the crate onto the plate to open the gate and reach the finish' : 'Pull the lever to open the gate and reach the finish',
    parts,
    notes: 'A wall with a gate; the gate listens for "open" (message) and slides up; the plate or lever sends it. Finish behind the gate.',
  };
}

/** Kick the ball into the goal. */
function football(r: Rng): Game {
  const L = r.int(26, 36);
  const Wd = r.int(16, 22);
  const goals = r.int(3, 5);
  const parts: GamePart[] = [
    { text: `A green pitch ${Wd} by ${L} m with low walls around it`, reply: 'A pitch with walls.', steps: [
      create('cube', { name: 'Pitch', at: [0, 0.05, 0], size: [Wd, 0.1, L], color: COLORS.green }),
      create('cube', { name: 'Side Wall Left', at: v3(-Wd / 2, 0.5, 0), size: [0.4, 1, L], color: COLORS.white }),
      create('cube', { name: 'Side Wall Right', at: v3(Wd / 2, 0.5, 0), size: [0.4, 1, L], color: COLORS.white }),
      create('cube', { name: 'End Wall', at: v3(0, 0.5, L / 2), size: [Wd, 1, 0.4], color: COLORS.white }),
    ] },
    { text: 'A goal at the far end that scores when the ball goes in', reply: 'A goal at the far end.', steps: [create('cube', { name: 'Goal', at: v3(0, 1.25, -L / 2), size: [6, 2.5, 1], color: COLORS.white, traits: ['trigger'] }), script('Goal', S.goal('Ball'))] },
    { text: 'A ball in the middle you can push, that comes back after a goal', reply: 'A ball to kick.', steps: [create('sphere', { name: 'Ball', at: [0, 1, 0], color: COLORS.white, traits: ['pushable', 'bouncy'] }), script('Ball', S.ballReset([0, 1, 0]))] },
    { text: 'The player behind the ball', reply: 'The player is ready.', steps: [create('player', { at: [0, 1, 4] })] },
    { text: `Score on screen, win at ${goals} goals`, reply: `${goals} goals wins.`, steps: manager('Game', S.scoreGoal(goals, 'Goals', 'You win the match!')) },
  ];
  if (r.chance(0.5)) parts.push({ text: 'A goalkeeper that moves side to side', reply: 'A goalkeeper guards the goal.', steps: [create('capsule', { name: 'Goalkeeper', at: v3(-2, 1, -L / 2 + 2), color: COLORS.red, traits: ['patrolling'] })] });
  if (r.chance(0.4)) parts.push(lookPart(r, r.pick(['Cartoon', 'Realistic'])));
  return { kind: 'game-football', flat: false, ask: say(r, r.pick(['a football game', 'a soccer game', 'kick a ball into a goal', `score ${goals} goals game`]), []), summary: `Push the ball into the goal ${goals} times`, parts, notes: 'Pitch with walls, a trigger goal that adds score and sends "reset" to the ball, a pushable bouncy ball, score goal.' };
}

/** Carry packages to houses. */
function delivery(r: Rng): Game {
  const n = r.int(2, 4);
  const parts: GamePart[] = [];
  const houses = [...Array(n)].map((_, i) => ({ name: `House ${i + 1}`, at: v3(Math.sin(i * 2.4) * r.int(14, 22), 1.5, Math.cos(i * 2.4) * r.int(14, 22)) }));
  parts.push({ text: `${n} houses spread out`, reply: `${n} houses to deliver to.`, steps: houses.map((h) => create('cube', { name: h.name, at: h.at, size: [4, 3, 4], color: r.pick([COLORS.white, COLORS.sand, COLORS.wood]) })) });
  parts.push({ text: 'A drop-off spot in front of every house', reply: 'Drop-off spots ready.', steps: houses.flatMap((h, i) => [create('cube', { name: `Drop Off ${i + 1}`, at: v3(h.at[0] * 0.8, 0.05, h.at[2] * 0.8), size: [2, 0.1, 2], color: COLORS.yellow, traits: ['trigger'] }), script(`Drop Off ${i + 1}`, S.dropZone('Package'))]) });
  parts.push({ text: `${n} packages at the depot to carry with E`, reply: `${n} packages to carry.`, steps: [...Array(n)].map((_, i) => create('cube', { name: 'Package', at: v3(i * 1.2 - n * 0.5, 0.4, 2), size: [0.8, 0.8, 0.8], color: COLORS.brown, traits: ['pickup'] })) });
  parts.push({ text: 'The player at the depot', reply: 'The player starts at the depot.', steps: [create('player', { at: [0, 1, 5] })] });
  parts.push({ text: `Deliveries on screen, win at ${n}`, reply: 'Deliveries are counted.', steps: manager('Game', S.scoreGoal(n, 'Delivered', 'All packages delivered!')) });
  if (r.chance(0.5)) parts.push({ text: `A ${r.pick([90, 120])} second timer`, reply: 'Beat the clock.', steps: manager('Timer', S.countdown(r.pick([90, 120]))) });
  return { kind: 'game-delivery', flat: false, ask: say(r, r.pick(['a delivery game', 'deliver packages to houses', 'a mail delivery game']), []), summary: `Carry ${n} packages to the houses`, parts, notes: 'Houses, trigger drop-off spots that count a "Package" touching them and remove it, pickup packages, a score goal.' };
}

/** Jump across rooftops. */
function rooftops(r: Rng): Game {
  const n = r.int(6, 10);
  const parts: GamePart[] = [];
  const roofs: Spot[] = [];
  let x = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    const h = r.int(6, 14) + i;
    const w = r.int(5, 8);
    roofs.push({ name: `Building ${i + 1}`, at: v3(x, h / 2, z), size: v3(w, h, w) });
    x += r.int(-3, 3);
    z -= w + r.int(2, 3);
  }
  parts.push({ text: `${n} buildings in a line, each a bit taller, with gaps to jump`, reply: `${n} buildings to jump across.`, steps: roofs.map((s) => create('cube', { name: s.name, at: s.at, size: s.size, color: r.pick([COLORS.grey, COLORS.stone, COLORS.sand, '#6a7a8a']) })) });
  parts.push({ text: 'The player on the first roof', reply: 'The player is on the first roof.', steps: [create('player', { at: top(roofs[0], 1) })] });
  if (r.chance(0.6)) parts.push({ text: 'A coin on each roof', reply: 'Coins on the roofs.', steps: roofs.slice(1).map((s, i) => create('coin', { name: `Coin ${i + 1}`, at: top(s, 1) })) });
  if (r.chance(0.5)) parts.push({ text: 'Jump pads on some roofs for the big jumps', reply: 'Jump pads added.', steps: roofs.filter((_, i) => i % 3 === 1).map((s, i) => create('cube', { name: `Jump Pad ${i + 1}`, at: top(s, 0.1), size: [1.2, 0.2, 1.2], color: COLORS.green, traits: ['jump-pad'] })) });
  parts.push({ text: 'A finish on the last roof', reply: 'The finish is on the last roof.', steps: [create('finish', { name: 'Finish', at: top(roofs[n - 1], 0.1) })] });
  parts.push(timeOfDay(r, r.pick(['day', 'sunset', 'night'])));
  return { kind: 'game-rooftops', flat: false, ask: say(r, r.pick(['a rooftop parkour game', 'jump across buildings', 'a city parkour level', 'rooftop running']), []), summary: `Jump across ${n} rooftops to the finish`, parts, notes: 'Tall cubes as buildings, each a bit taller with 2-3 m gaps; player on the first roof; finish on the last.' };
}

/** Survive a chaser: tag. */
function tag(r: Rng): Game {
  const secs = r.pick([30, 45, 60]);
  const k = r.int(1, 3);
  const parts: GamePart[] = [
    { text: 'Obstacles to run around', reply: 'Obstacles to hide behind.', steps: [{ do: 'scatter', what: 'cube', name: 'Obstacle', count: r.int(10, 20), at: [0, 0, 0], area: [36, 36], size: [2, 2.5, 2], color: COLORS.stone }] },
    { text: 'The player in the middle', reply: 'The player is in the middle.', steps: [create('player', { at: [0, 1, 0], traits: ['health'] })] },
    { text: `${plural(k, 'chaser')} that ${k === 1 ? 'runs' : 'run'} after you`, reply: 'They are coming for you.', steps: [...Array(k)].flatMap((_, i) => [create('capsule', { name: `Chaser ${i + 1}`, at: v3(r.pick([-15, 15]), 1, r.pick([-15, 15])), color: COLORS.red, traits: ['damaging'] }), script(`Chaser ${i + 1}`, S.chaser(0.5))]) },
    { text: `Survive ${secs} seconds to win`, reply: `Survive ${secs} seconds.`, steps: manager('Game', S.survive(secs)) },
  ];
  if (r.chance(0.4)) parts.push({ text: 'Health pickups', reply: 'Health pickups around.', steps: [{ do: 'scatter', what: 'sphere', name: 'Health', count: 3, at: [0, 1, 0], area: [30, 30], size: [0.6, 0.6, 0.6], color: COLORS.green, traits: ['healing'] }] });
  return { kind: 'game-tag', flat: false, ask: say(r, r.pick(['a tag game', 'run away from a monster', 'a chase game', `survive ${secs} seconds without getting caught`]), []), summary: `Don't get caught for ${secs} seconds`, parts, notes: 'Obstacles, a player with health, chasers with a chase script and damaging, a survive timer.' };
}

/** A dungeon: rooms joined by corridors, torches, enemies, a key, a locked treasure room. */
function dungeon(r: Rng): Game {
  const n = r.int(3, 4);
  const size = r.pick([10, 12]);
  const gap = 6;
  const wallC = '#55504a';
  const parts: GamePart[] = [{ text: 'Make it dark like underground', reply: 'Dark like a dungeon.', steps: [{ do: 'settings', field: 'exposure', value: '0.35' }, { do: 'settings', field: 'background', value: '#08070a' }] }];
  const rooms: V3[] = [...Array(n)].map((_, i) => v3(0, 0, -i * (size + gap)));
  const walls: Step[] = [];
  rooms.forEach((c, i) => {
    const h = size / 2;
    walls.push(create('cube', { name: `Room ${i + 1} Left Wall`, at: v3(c[0] - h, 1.75, c[2]), size: v3(0.5, 3.5, size), color: wallC }));
    walls.push(create('cube', { name: `Room ${i + 1} Right Wall`, at: v3(c[0] + h, 1.75, c[2]), size: v3(0.5, 3.5, size), color: wallC }));
    // Front and back walls with a 2 m doorway in the middle (none at the very start).
    for (const [side, z] of [['Back', c[2] - h], ['Front', c[2] + h]] as const) {
      if (side === 'Front' && i === 0) walls.push(create('cube', { name: `Room ${i + 1} Front Wall`, at: v3(c[0], 1.75, z), size: v3(size, 3.5, 0.5), color: wallC }));
      else if (!(side === 'Back' && i === n - 1)) {
        walls.push(create('cube', { name: `Room ${i + 1} ${side} Wall A`, at: v3(c[0] - h / 2 - 0.5, 1.75, z), size: v3(h - 1, 3.5, 0.5), color: wallC }));
        walls.push(create('cube', { name: `Room ${i + 1} ${side} Wall B`, at: v3(c[0] + h / 2 + 0.5, 1.75, z), size: v3(h - 1, 3.5, 0.5), color: wallC }));
      } else walls.push(create('cube', { name: `Room ${i + 1} Back Wall`, at: v3(c[0], 1.75, z), size: v3(size, 3.5, 0.5), color: wallC }));
    }
  });
  parts.push({ text: `${n} stone rooms in a line, each with doorways`, reply: `Built ${n} rooms.`, steps: walls });
  const corridors: Step[] = [];
  for (let i = 0; i < n - 1; i++) {
    const z = rooms[i][2] - size / 2 - gap / 2;
    corridors.push(create('cube', { name: `Corridor ${i + 1} Left`, at: v3(-1.25, 1.75, z), size: v3(0.5, 3.5, gap), color: wallC }), create('cube', { name: `Corridor ${i + 1} Right`, at: v3(1.25, 1.75, z), size: v3(0.5, 3.5, gap), color: wallC }));
  }
  parts.push({ text: 'Narrow corridors joining the rooms', reply: 'Corridors between the rooms.', steps: corridors });
  parts.push({ text: 'Torches in every room', reply: 'Torches light the rooms.', steps: rooms.map((c, i) => create('light', { name: `Torch ${i + 1}`, at: v3(c[0] + size / 2 - 1, 2.5, c[2]), color: '#ff9a40' })) });
  const foes = rooms.slice(1).map((c, i) => create('capsule', { name: r.pick(['Skeleton', 'Goblin', 'Zombie']) + ` ${i + 1}`, at: v3(c[0] + r.int(-2, 2), 1, c[2]), color: r.pick([COLORS.grey, COLORS.green, COLORS.dark]), traits: ['enemy', 'health'] }));
  parts.push({ text: 'An enemy guarding each room after the first', reply: `${foes.length} enemies guard the rooms.`, steps: foes });
  const keyRoom = rooms[r.int(1, n - 2)] ?? rooms[1];
  parts.push({ text: 'A key in one of the rooms', reply: 'A key is hidden in a room.', steps: [create('torus', { name: 'Key', at: v3(keyRoom[0] - 3, 1, keyRoom[2] - 2), size: [0.6, 0.6, 0.6], color: COLORS.yellow, traits: ['spinning', 'trigger'] }), script('Key', S.key(1, 'key'))] });
  const last = rooms[n - 1];
  parts.push({ text: 'A locked door into the last room, opened with the key', reply: 'The last room is locked.', steps: [create('cube', { name: 'Locked Door', at: v3(0, 1.5, last[2] + size / 2), size: [2, 3, 0.3], color: COLORS.wood }), script('Locked Door', S.lockedDoor(1, 'key'))] });
  parts.push({ text: 'A treasure chest in the last room that wins the game', reply: 'Treasure waits in the last room.', steps: [create('cube', { name: 'Treasure', at: v3(0, 0.4, last[2] - 2), size: [1.4, 0.8, 0.9], color: COLORS.yellow, traits: ['trigger'] }), script('Treasure', S.treasure('You found the treasure!'))] });
  parts.push({ text: 'The player in the first room, with health', reply: 'The player starts in the first room.', steps: [create('player', { at: v3(0, 1, rooms[0][2] + 2), traits: ['health'] })] });
  return { kind: 'game-dungeon', flat: false, ask: say(r, r.pick(['a dungeon crawler', 'a dungeon with monsters and treasure', 'a dungeon game', `a ${n} room dungeon`]), []), summary: `Fight through ${n} dungeon rooms, find the key and the treasure`, parts, notes: 'Rooms of walls with 2 m doorways, corridors between them, torches, an enemy per room, a key that opens the last room, treasure that wins. Dark.' };
}

/** A farm: fields, a barn, fences, animals, eggs to collect for the farmer. */
function farm(r: Rng): Game {
  const rows = r.int(3, 6);
  const eggs = r.int(5, 10);
  const parts: GamePart[] = [];
  parts.push({ text: 'A red barn', reply: 'A big red barn.', steps: [create('cube', { name: 'Barn', at: [-12, 2.5, -8], size: [8, 5, 10], color: '#a83a2a' }), create('cone', { name: 'Barn Roof', at: [-12, 6, -8], rotate: [0, 45, 0], size: [12, 2.5, 14], color: COLORS.dark })] });
  parts.push({ text: `${rows} rows of crops in a field`, reply: `${rows} rows of crops.`, steps: [...Array(rows)].map((_, i) => ({ do: 'row', what: 'cube', name: `Crop ${String.fromCharCode(65 + i)}`, count: 8, at: v3(4, 0.4, -12 + i * 2.5), step: [1.5, 0, 0], size: [0.8, 0.8, 0.8], color: r.pick([COLORS.green, '#6fbf3c', COLORS.yellow]) }) as Step) });
  parts.push({ text: 'A wooden fence around the field', reply: 'Fenced the field.', steps: [
    create('cube', { name: 'Fence North', at: [9.5, 0.5, -14], size: [14, 1, 0.2], color: COLORS.wood }),
    create('cube', { name: 'Fence South', at: v3(9.5, 0.5, -12 + rows * 2.5), size: [14, 1, 0.2], color: COLORS.wood }),
    create('cube', { name: 'Fence West', at: v3(2.5, 0.5, -13 + rows * 1.25), size: v3(0.2, 1, rows * 2.5 + 2), color: COLORS.wood }),
    create('cube', { name: 'Fence East', at: v3(16.5, 0.5, -13 + rows * 1.25), size: v3(0.2, 1, rows * 2.5 + 2), color: COLORS.wood }),
  ] });
  const animal = r.pick(['Chicken', 'Sheep', 'Pig', 'Cow']);
  const k = r.int(2, 5);
  parts.push({ text: `${k} ${animal.toLowerCase()}s wandering around`, reply: `${k} ${animal.toLowerCase()}s wander about.`, steps: [...Array(k)].map((_, i) => create('capsule', { name: `${animal} ${i + 1}`, at: v3(r.int(-14, -4), 0.6, r.int(2, 10)), size: [0.8, 0.6, 0.8], color: animal === 'Pig' ? COLORS.pink : animal === 'Sheep' ? COLORS.white : animal === 'Cow' ? COLORS.dark : COLORS.white, traits: ['patrolling'] })) });
  parts.push({ text: `${eggs} eggs hidden around the farm`, reply: `Hid ${eggs} eggs.`, steps: [{ do: 'scatter', what: 'sphere', name: 'Egg', count: eggs, at: [-4, 0.3, 0], area: [30, 26], size: [0.35, 0.45, 0.35], color: COLORS.white, traits: ['collectible'] }] });
  parts.push({ text: `A farmer who asks you to collect the eggs`, reply: 'The farmer has a job for you.', steps: [create('capsule', { name: 'Farmer', at: [-7, 1, -2], color: COLORS.blue }), script('Farmer', S.talk(`Can you find my ${eggs} eggs? The hens hid them everywhere!`)), ...manager('Game', S.scoreGoal(eggs, 'Eggs', 'You found every egg!'))] });
  parts.push({ text: 'The player by the barn', reply: 'The player starts by the barn.', steps: [create('player', { at: [-6, 1, 2] })] });
  if (r.chance(0.5)) parts.push(timeOfDay(r, r.pick(['day', 'sunset'])));
  if (r.chance(0.4)) parts.push(lookPart(r, 'Cartoon'));
  return { kind: 'game-farm', flat: false, ask: say(r, r.pick(['a farm game', 'a farm with animals', `collect ${eggs} eggs on a farm`, 'a cozy farm']), []), summary: `A farm: find the farmer's ${eggs} eggs`, parts, notes: 'A barn (cube and cone roof), rows of crops (row steps), a fence, patrolling animals, eggs as collectibles, a farmer who explains, a score goal.' };
}

/** On the moon: craters, crystals, a rocket home. */
function moon(r: Rng): Game {
  const crystals = r.int(6, 12);
  const parts: GamePart[] = [
    { text: 'Make it space: a black sky and grey ground', reply: 'We are on the moon.', steps: [{ do: 'settings', field: 'background', value: '#020208' }, { do: 'edit', object: 'Ground', color: '#8a8a90' }] },
    { text: `Craters all over the ground`, reply: 'Craters everywhere.', steps: [{ do: 'scatter', what: 'cylinder', name: 'Crater', count: r.int(8, 16), at: [0, 0.1, 0], area: [44, 44], size: [4, 0.2, 4], color: '#5a5a60' }] },
    { text: 'Some moon rocks', reply: 'Moon rocks around.', steps: [{ do: 'scatter', what: 'sphere', name: 'Moon Rock', count: r.int(8, 15), at: [0, 0, 0], area: [44, 44], size: [1.5, 1, 1.5], color: '#6a6a70' }] },
    { text: `${crystals} glowing crystals to collect`, reply: `${crystals} crystals to find.`, steps: [{ do: 'scatter', what: 'coin', name: 'Crystal', count: crystals, at: [0, 1, 0], area: [40, 40], color: COLORS.teal }] },
    { text: 'A rocket that takes you home once you have all the crystals', reply: 'The rocket waits.', steps: [create('cylinder', { name: 'Rocket', at: [10, 3, -10], size: [2, 6, 2], color: COLORS.white }), create('cone', { name: 'Rocket Nose', at: [10, 7, -10], size: [2, 2, 2], color: COLORS.red }), ...manager('Game', S.scoreGoal(crystals, 'Crystals', 'Fuel full! Fly home in the rocket!'))] },
    { text: 'The astronaut player next to the base', reply: 'The astronaut is ready.', steps: [create('player', { at: [0, 1, 6] }), create('cube', { name: 'Moon Base', at: [-4, 1.5, 8], size: [5, 3, 5], color: COLORS.white })] },
  ];
  if (r.chance(0.4)) parts.push({ text: 'A glowing light at the base', reply: 'A light at the base.', steps: [create('light', { name: 'Base Light', at: [-4, 4, 8], color: '#a0c0ff' })] });
  return { kind: 'game-moon', flat: false, ask: say(r, r.pick(['a space game on the moon', 'a moon base', 'collect crystals on the moon', 'an astronaut game']), []), summary: `Collect ${crystals} crystals on the moon`, parts, notes: 'Black background, the Ground recoloured grey, scattered craters (flat cylinders) and rocks, crystals as coins, a rocket and a score goal.' };
}

/** A winter level: snow, snowmen, ice, pine trees. */
function winter(r: Rng): Game {
  const n = r.int(5, 9);
  const parts: GamePart[] = [
    { text: 'Snow on the ground', reply: 'Everything is snowy.', steps: [{ do: 'edit', object: 'Ground', color: '#f2f4f8' }] },
    { text: 'Pine forests on both sides', reply: 'Pine forests on both sides.', steps: [create('plants', { name: 'Pine Trees Left', at: [-16, 0, -16], area: [14, 40], count: r.int(25, 60) }), create('plants', { name: 'Pine Trees Right', at: [16, 0, -16], area: [14, 40], count: r.int(25, 60) })] },
    { text: `${r.int(2, 4)} snowmen`, reply: 'Built some snowmen.', steps: [...Array(3)].flatMap((_, i) => { const x = r.int(-15, 15); const z = r.int(-15, 15); return [create('sphere', { name: `Snowman ${i + 1}`, at: v3(x, 0, z), size: [1.6, 1.6, 1.6], color: COLORS.white }), create('sphere', { name: `Snowman ${i + 1} Head`, at: v3(x, 1.9, z), size: [1, 1, 1], color: COLORS.white })]; }) },
    { text: `${n} slippery ice platforms to cross`, reply: `${n} icy platforms.`, steps: [{ do: 'row', what: 'platform', name: 'Ice', count: n, at: [0, 1.5, -6], step: [0, 0.6, -4.5], size: [3, 0.4, 3], color: '#b0e0f8', traits: ['slippery'] }] },
    { text: 'A finish on the last ice platform', reply: 'The finish is on the last one.', steps: [create('finish', { name: 'Finish', at: v3(0, 1.5 + 0.6 * (n - 1) + 0.3, -6 - 4.5 * (n - 1)) })] },
    { text: 'The player at the start', reply: 'The player is ready.', steps: [create('player', { at: [0, 0, -1] })] },
    { text: 'A cold, hazy sky', reply: 'Cold and hazy.', steps: [create('sky'), create('fog'), { do: 'settings', field: 'exposure', value: '1.2' }] },
  ];
  return { kind: 'game-winter', flat: false, ask: say(r, r.pick(['a winter level', 'a snowy obby', 'a snow world with ice', 'an ice level with snowmen']), []), summary: `A snowy level: cross ${n} icy platforms`, parts, notes: 'The Ground coloured white, pine trees on both sides, snowmen of two spheres, slippery platforms in a row rising, a finish on the last one.' };
}

// ── the games (2D) ──────────────────────────────────────────────────────────

/** A side-on platformer level: ground with gaps, platforms, coins, enemies, finish. */
function platformer2d(r: Rng): Game {
  const segs = r.int(4, 7);
  const parts: GamePart[] = [];
  const ground: Spot[] = [];
  let x = -6;
  for (let i = 0; i < segs; i++) {
    const w = r.int(6, 12);
    ground.push({ name: `Ground ${i + 1}`, at: v3(x + w / 2, -0.5, 0), size: v3(w, 1, 1) });
    x += w + r.pick([2, 2.5, 3]);
  }
  const end = x;
  parts.push({ text: `Ground in ${segs} pieces with gaps to jump over`, reply: `${segs} pieces of ground.`, steps: ground.map((g) => create('platform', { name: g.name, at: g.at, size: g.size, color: COLORS.brown })) });
  parts.push({ text: 'A kill zone below the gaps that sends you back', reply: 'Falling in a gap sends you back.', steps: [create('sprite', { name: 'Pit', at: v3(end / 2, -5, 0), size: v3(end + 20, 1, 1), color: '#30303a', traits: ['kill-zone'] })] });
  const plats: Spot[] = [];
  for (let i = 0; i < r.int(3, 7); i++) plats.push({ name: `Platform ${i + 1}`, at: v3(r.int(0, Math.floor(end) - 4), r.pick([2, 3, 3.5, 4]), 0), size: [r.pick([3, 4]), 0.5, 1] });
  parts.push({ text: 'Platforms at different heights above the ground', reply: `${plats.length} platforms to jump on.`, steps: plats.map((p) => create('platform', { name: p.name, at: p.at, size: p.size, color: COLORS.stone })) });
  if (r.chance(0.8)) parts.push({ text: 'Coins above the platforms', reply: 'Coins above the platforms.', steps: plats.map((p, i) => create('coin', { name: `Coin ${i + 1}`, at: v3(p.at[0], p.at[1] + 1.2, 0) })) });
  if (r.chance(0.6)) {
    const on = ground.filter((g) => g.size[0] >= 8).slice(0, 3);
    if (on.length) parts.push({ text: 'Enemies walking back and forth on the ground', reply: `${plural(on.length, 'enemy', 'enemies')} on patrol.`, steps: on.map((g, i) => create('sprite', { name: `Enemy ${i + 1}`, at: v3(g.at[0], 0.6, 0), size: [1, 1, 1], color: COLORS.red, traits: ['patrolling', 'damaging'] })) });
  }
  if (r.chance(0.4)) parts.push({ text: `A checkpoint halfway`, reply: 'A checkpoint halfway.', steps: [traits(ground[Math.floor(segs / 2)].name, ['checkpoint'])] });
  if (r.chance(0.3)) parts.push({ text: 'A jump pad to reach a high platform', reply: 'A jump pad.', steps: [create('sprite', { name: 'Jump Pad', at: v3(ground[1].at[0], 0.15, 0), size: [1.5, 0.3, 1], color: COLORS.green, traits: ['jump-pad'] })] });
  parts.push({ text: 'A player at the start', reply: 'The player is at the start.', steps: [create('player', { at: [-4, 1.5, 0] })] });
  parts.push({ text: 'A finish flag at the end', reply: 'The finish is at the end.', steps: [create('finish', { name: 'Finish', at: v3(ground[segs - 1].at[0] + ground[segs - 1].size[0] / 2 - 1, 1, 0) })] });
  if (r.chance(0.5)) parts.push({ text: 'A sky background', reply: 'A sky behind the level.', steps: [create('background', { name: 'Sky', color: r.pick(['#9fc5e8', '#f0b080', '#203050']) })] });
  return {
    kind: 'game-2d-platformer',
    flat: true,
    ask: say(r, r.pick(['a 2D platformer', 'a mario style level', 'a platformer level', 'a side scrolling level', 'a 2D level with jumps']), []),
    summary: 'A side-on level: jump across gaps and platforms to the finish',
    parts,
    notes: 'Ground pieces with 2-3 m gaps and a kill zone below, platforms 2-4 m up, coins above them, patrolling enemies, player at the left, finish at the right.',
  };
}

/** Climb up in 2D. */
function climb2d(r: Rng): Game {
  const n = r.int(8, 14);
  const parts: GamePart[] = [{ text: 'A floor at the bottom', reply: 'A floor.', steps: [create('platform', { name: 'Floor', at: [0, -0.5, 0], size: [16, 1, 1], color: COLORS.brown })] }];
  const plats: Spot[] = [];
  for (let i = 0; i < n; i++) plats.push({ name: `Ledge ${i + 1}`, at: v3((i % 2 ? 1 : -1) * r.int(2, 5), 2 + i * 2, 0), size: [3, 0.5, 1] });
  parts.push({ text: `${n} ledges zigzagging up, 2 m apart`, reply: `${n} ledges going up.`, steps: plats.map((p) => create('platform', { name: p.name, at: p.at, size: p.size, color: COLORS.stone })) });
  if (r.chance(0.5)) parts.push({ text: 'Some ledges move side to side', reply: 'Some ledges move.', steps: plats.filter((_, i) => i % 4 === 2).map((p) => traits(p.name, ['moving-platform'])) });
  parts.push({ text: 'The player on the floor', reply: 'The player is on the floor.', steps: [create('player', { at: [0, 1, 0] })] });
  parts.push({ text: 'A finish on the top ledge', reply: 'The finish is on top.', steps: [create('finish', { name: 'Finish', at: v3(plats[n - 1].at[0], plats[n - 1].at[1] + 1.2, 0) })] });
  if (r.chance(0.5)) parts.push({ text: 'Coins on the way up', reply: 'Coins on the way up.', steps: plats.filter((_, i) => i % 2 === 0).map((p, i) => create('coin', { name: `Coin ${i + 1}`, at: v3(p.at[0], p.at[1] + 1, 0) })) });
  return { kind: 'game-2d-climb', flat: true, ask: say(r, r.pick(['a 2D climbing game', 'jump up to the top', 'a vertical platformer', 'a tower climb in 2D']), []), summary: `Climb ${n} ledges to the top`, parts, notes: 'Ledges alternating left and right, 2 m higher each; player on the floor; finish on the top ledge.' };
}

/** A dark cave in 2D with torches and gems. */
function cave2d(r: Rng): Game {
  const n = r.int(4, 6);
  const parts: GamePart[] = [{ text: 'Make it dark like a cave', reply: 'It is dark now.', steps: [{ do: 'settings', field: 'darkness2D', value: String(r.pick([0.7, 0.8, 0.9])) }, { do: 'settings', field: 'background', value: '#15121a' }] }];
  const floor: Spot[] = [...Array(n)].map((_, i) => ({ name: `Rock ${i + 1}`, at: v3(i * 9, -0.5 + (i % 2) * 1.5, 0), size: [7, 1, 1] }));
  parts.push({ text: 'A rocky cave floor going up and down', reply: 'A rocky floor.', steps: floor.map((f) => create('platform', { name: f.name, at: f.at, size: f.size, color: COLORS.stone })) });
  parts.push({ text: 'Torches along the way that light the cave', reply: 'Torches light the way.', steps: floor.map((f, i) => create('light', { name: `Torch ${i + 1}`, at: v3(f.at[0], f.at[1] + 3, 0), color: '#ffa040' })) });
  const gems = r.int(4, 8);
  parts.push({ text: `${gems} glowing gems to collect`, reply: `${gems} gems to find.`, steps: [...Array(gems)].map((_, i) => create('coin', { name: `Gem ${i + 1}`, at: v3(r.int(0, n * 9 - 4), r.int(1, 4), 0), color: COLORS.teal })) });
  parts.push({ text: 'The player at the cave entrance', reply: 'The player is at the entrance.', steps: [create('player', { at: [0, 1, 0] })] });
  parts.push({ text: `Gems on screen, win with all ${gems}`, reply: 'Gems are counted.', steps: manager('Game', S.scoreGoal(gems, 'Gems', 'You found every gem!')) });
  return { kind: 'game-2d-cave', flat: true, ask: say(r, r.pick(['a dark cave game in 2D', 'a 2D cave with torches', 'collect gems in a dark cave']), []), summary: `Find ${gems} gems in a dark cave lit by torches`, parts, notes: 'darkness2D setting, rock platforms, Light2D torches above them, gems (coins), score goal.' };
}

/** Collect coins in 2D before the time runs out. */
function rush2d(r: Rng): Game {
  const coins = r.int(8, 16);
  const secs = r.pick([20, 30, 45]);
  const parts: GamePart[] = [
    { text: 'A wide floor and some platforms', reply: 'A floor and platforms.', steps: [create('platform', { name: 'Floor', at: [0, -0.5, 0], size: [30, 1, 1], color: COLORS.brown }), ...[...Array(r.int(3, 6))].map((_, i) => create('platform', { name: `Platform ${i + 1}`, at: v3(-12 + i * 5, r.pick([2, 3, 4]), 0), size: [3, 0.5, 1], color: COLORS.stone }))] },
    { text: `${coins} coins all over the level`, reply: `${coins} coins.`, steps: [...Array(coins)].map((_, i) => create('coin', { name: `Coin ${i + 1}`, at: v3(r.int(-13, 13), r.int(1, 5), 0) })) },
    { text: 'The player in the middle', reply: 'The player is in the middle.', steps: [create('player', { at: [0, 1, 0] })] },
    { text: `Coins on screen, win with all ${coins}`, reply: 'Coins are counted.', steps: manager('Game', S.scoreGoal(coins, 'Coins', 'You got them all!')) },
    { text: `A ${secs} second timer`, reply: `${secs} seconds on the clock.`, steps: manager('Timer', S.countdown(secs)) },
  ];
  return { kind: 'game-2d-rush', flat: true, ask: say(r, r.pick(['a 2D coin rush', `collect ${coins} coins in ${secs} seconds`, 'a 2D timed coin game']), []), summary: `Collect ${coins} coins in ${secs} seconds`, parts, notes: 'Floor and platforms, coins spread over the level, a score goal and a countdown.' };
}

/** Find the key, open the door (2D). */
function keyDoor2d(r: Rng): Game {
  const parts: GamePart[] = [
    { text: 'Ground and a few platforms', reply: 'Ground and platforms.', steps: [create('platform', { name: 'Ground', at: [8, -0.5, 0], size: [36, 1, 1], color: COLORS.brown }), create('platform', { name: 'High Ledge', at: [r.int(0, 6), 4, 0], size: [3, 0.5, 1], color: COLORS.stone }), create('platform', { name: 'Step', at: [-2, 2, 0], size: [3, 0.5, 1], color: COLORS.stone })] },
    { text: 'A key up on the high ledge', reply: 'The key is up high.', steps: [create('sprite', { name: 'Key', at: [r.int(0, 6), 5.2, 0], size: [0.6, 0.6, 1], color: COLORS.yellow, traits: ['trigger'] }), script('Key', S.key(1, 'key'))] },
    { text: 'A locked door that opens with the key', reply: 'A locked door.', steps: [create('sprite', { name: 'Door', at: [18, 1.5, 0], size: [1, 3, 1], color: COLORS.wood, traits: ['solid'] }), script('Door', S.lockedDoor(1, 'key'))] },
    { text: 'A finish behind the door', reply: 'The finish is behind the door.', steps: [create('finish', { name: 'Finish', at: [22, 1, 0] })] },
    { text: 'The player at the start', reply: 'The player is at the start.', steps: [create('player', { at: [-6, 1, 0] })] },
  ];
  return { kind: 'game-2d-key', flat: true, ask: say(r, r.pick(['a 2D game where you find a key', 'a 2D level with a locked door', 'get the key and open the door']), []), summary: 'Get the key from the high ledge to open the door to the finish', parts, notes: 'Ground, a high ledge with a key (script adds game.keys), a door that checks it, finish behind.' };
}

/** Escape rising danger in 2D: lava below, platforms up. */
function lava2d(r: Rng): Game {
  const n = r.int(8, 12);
  const parts: GamePart[] = [
    { text: 'A lava floor that sends you back', reply: 'Lava below!', steps: [create('sprite', { name: 'Lava', at: [10, -1, 0], size: [60, 1, 1], color: '#e0401a', traits: ['deadly'] })] },
    { text: 'A start platform with the player', reply: 'The player is on the start platform.', steps: [create('platform', { name: 'Start', at: [-6, 1, 0], size: [4, 0.5, 1], color: COLORS.stone }), create('player', { at: [-6, 2.5, 0] })] },
  ];
  const plats: Spot[] = [...Array(n)].map((_, i) => ({ name: `Rock ${i + 1}`, at: v3(-1 + i * r.pick([3.5, 4]), 1 + Math.sin(i) * 1.5 + 0.5, 0), size: [r.pick([2, 2.5, 3]), 0.5, 1] }));
  parts.push({ text: `${n} rocks to jump across over the lava`, reply: `${n} rocks over the lava.`, steps: plats.map((p) => create('platform', { name: p.name, at: p.at, size: p.size, color: '#5a4a40' })) });
  if (r.chance(0.5)) parts.push({ text: 'Some rocks sink away after you land', reply: 'Some rocks disappear.', steps: plats.filter((_, i) => i % 3 === 2).map((p) => traits(p.name, ['disappearing'])) });
  parts.push({ text: 'A finish on the last rock', reply: 'Reach the last rock to win.', steps: [create('finish', { name: 'Finish', at: v3(plats[n - 1].at[0], plats[n - 1].at[1] + 1.2, 0) })] });
  parts.push({ text: 'An orange glow background', reply: 'A hot orange sky.', steps: [create('background', { name: 'Glow', color: '#f08040' })] });
  return { kind: 'game-2d-lava', flat: true, ask: say(r, r.pick(['a 2D lava game', 'the floor is lava in 2D', 'jump over lava 2d']), []), summary: `Jump across ${n} rocks over lava`, parts, notes: 'Deadly lava sprite along the bottom, platforms over it at varying heights, player on a start platform, finish on the last.' };
}

// ── vague requests: questions, then the answers lead to a game ─────────────

const VAGUE_3D: { ask: string; q: { q: string; options: string[] }[]; to: (a: string[]) => string }[] = [
  { ask: 'make a game', q: [{ q: 'What kind of game?', options: ['Obby / parkour', 'Maze', 'Collect things', 'Survive enemies'] }, { q: 'Day or night?', options: ['Day', 'Night'] }], to: (a) => a[0] },
  { ask: 'make something fun', q: [{ q: 'What should you do in it?', options: ['Jump across platforms', 'Race through gates', 'Find treasure', 'Solve a puzzle'] }], to: (a) => a[0] },
  { ask: 'i want a scary game', q: [{ q: 'Where?', options: ['A haunted house', 'A dark maze'] }, { q: 'Should something chase you?', options: ['Yes, a monster', 'No'] }], to: (a) => (a[0].includes('house') ? 'Horror house' : 'Maze') },
  { ask: 'build a world', q: [{ q: 'What kind of place?', options: ['A village', 'An island', 'Mountains and forest'] }], to: (a) => a[0] },
  { ask: 'a game for my friends', q: [{ q: 'What kind?', options: ['A race', 'Football', 'Tag'] }], to: (a) => a[0] },
  { ask: 'make a level', q: [{ q: 'What kind of level?', options: ['Platforms to jump on', 'A maze', 'Rooftops'] }, { q: 'How hard?', options: ['Easy', 'Medium', 'Hard'] }], to: (a) => a[0] },
];
const VAGUE_2D: typeof VAGUE_3D = [
  { ask: 'make a 2d game', q: [{ q: 'What kind?', options: ['Platformer', 'Climb to the top', 'Collect coins fast'] }], to: (a) => a[0] },
  { ask: 'something fun in 2d', q: [{ q: 'What should you do?', options: ['Jump across gaps', 'Explore a dark cave', 'Find a key'] }], to: (a) => a[0] },
];

const PICK_3D: Record<string, (r: Rng) => Game> = {
  'Obby / parkour': obby, Maze: maze, 'A dark maze': maze, 'Collect things': coinHunt, 'Survive enemies': arena, 'Jump across platforms': obby, 'Race through gates': race, 'Find treasure': island,
  'Solve a puzzle': puzzle, 'Horror house': horrorHouse, 'A village': village, 'An island': island, 'Mountains and forest': nature, 'A race': race, Football: football, Tag: tag, 'Platforms to jump on': obby,
  'A maze': maze, Rooftops: rooftops,
};
const PICK_2D: Record<string, (r: Rng) => Game> = { Platformer: platformer2d, 'Climb to the top': climb2d, 'Collect coins fast': rush2d, 'Jump across gaps': platformer2d, 'Explore a dark cave': cave2d, 'Find a key': keyDoor2d };

const GAMES_3D = [obby, obby, coinHunt, maze, arena, race, village, horrorHouse, island, nature, tower, targets, puzzle, football, delivery, rooftops, tag, dungeon, farm, moon, winter];
const GAMES_2D = [platformer2d, platformer2d, climb2d, cave2d, rush2d, keyDoor2d, lava2d];

/** New objects a part makes (each part may make at most 60). */
const made = (p: GamePart) => p.steps.reduce((n, s) => n + (s.do === 'create' ? 1 : s.do === 'row' || s.do === 'scatter' ? (s.count ?? 1) : 0), 0);

/** The assistant plans at most 8 parts: join the smallest neighbours until it fits. */
function fit(parts: GamePart[]): GamePart[] {
  const out = [...parts];
  while (out.length > 8) {
    let best = -1;
    for (let i = 0; i < out.length - 1; i++) {
      if (made(out[i]) + made(out[i + 1]) > 60) continue;
      if (best < 0 || out[i].steps.length + out[i + 1].steps.length < out[best].steps.length + out[best + 1].steps.length) best = i;
    }
    if (best < 0) break;
    const [a, b] = [out[best], out[best + 1]];
    out.splice(best, 2, { text: `${a.text}, and ${b.text.charAt(0).toLowerCase()}${b.text.slice(1)}`, reply: `${a.reply} ${b.reply}`, steps: [...a.steps, ...b.steps] });
  }
  return out.slice(0, 8);
}

/** A new game (sometimes asked vaguely first). */
export function designGame(r: Rng, flat: boolean): Game {
  let g: Game;
  if (r.chance(0.15)) {
    const v = r.pick(flat ? VAGUE_2D : VAGUE_3D);
    const answers = v.q.map((q) => r.pick(q.options));
    const make = (flat ? PICK_2D : PICK_3D)[v.to(answers)] ?? r.pick(flat ? GAMES_2D : GAMES_3D);
    // Written the way the assistant sends them: each question with its answer.
    g = { ...make(r), vague: { ask: v.ask, questions: v.q, answers: v.q.map((q, i) => `${q.q} ${answers[i]}`).join('; ') } };
  } else g = r.pick(flat ? GAMES_2D : GAMES_3D)(r);
  return { ...g, parts: fit(g.parts) };
}
