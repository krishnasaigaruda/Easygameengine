import { useEditor } from '../state/editorStore';
import { checkPrompt, checkSchema, checkSystem, describeScene, lookAtScene } from './check';
import { thingOf } from './realModels';
import { sceneryTips } from './landscape';
import { chat } from './model';
import { docsFor } from './docs';
import { parsePlan, planSchema, systemPrompt, type Step } from './plan';
import { projectAssets, runPlan, sceneObjects, type RunReport } from './execute';

/*
 * The assistant's way of working, made for small models: never one big job. It first
 * understands the request (asking you when it's unclear), writes its own plan of parts, then
 * builds one part at a time, each with only the documentation that part needs and the scene as
 * it is now. When steps fail it is told why and fixes them. Before it's done it checks the scene
 * against the request (and the picture, if you gave one) and keeps building what's missing.
 * Everything it says at the end comes from what actually happened.
 */

export interface Question {
  q: string;
  options: string[];
}

export interface PartState {
  text: string;
  status: 'waiting' | 'working' | 'done' | 'partly' | 'failed';
  steps: Step[];
  report?: RunReport;
}

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'questions'; questions: Question[] }
  | { type: 'plan'; summary: string; parts: string[]; thought?: string }
  | { type: 'part'; index: number; part: PartState }
  /** Checking the scene against the request… */
  | { type: 'checking'; text: string }
  /** …and these parts were missing: built next. */
  | { type: 'more'; parts: string[] }
  | { type: 'writing'; chars: number };

export const understandSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          options: { type: 'array', maxItems: 4, items: { type: 'string' } },
        },
        required: ['q', 'options'],
      },
    },
    summary: { type: 'string' },
    parts: { type: 'array', maxItems: 8, items: { type: 'string' } },
  },
  required: ['questions', 'summary', 'parts'],
};

const sceneLine = () =>
  sceneObjects()
    .slice(0, 30)
    .map((o) => o.name)
    .join(', ') || 'empty';

/** What an attached picture shows (put into words), or ''. */
export function pictureOf(ask: string): string {
  const at = ask.indexOf('The attached picture');
  return at < 0
    ? ''
    : ask
        .slice(at)
        .replace(/\nBuild it to look like the picture\.?\s*$/, '')
        .trim();
}

/** The user's own words ask for a game (with a picture, it's otherwise a scene to rebuild). */
const GAME_WORDS =
  /\b(game|games|level|levels|obby|quest|collect|score|coins?|enemy|enemies|win|lose|race|shoot|puzzle|playable|boss|parkour)\b/i;

/** Changing a game that's already made: what was asked for before (this chat), for the model. */
export interface Editing {
  earlier: string[];
}

export function understandPrompt(dimension: '3d' | '2d', answered: boolean, ask = '', editing?: Editing): string {
  const picture = pictureOf(ask);
  const own = picture ? ask.slice(0, ask.indexOf('The attached picture')) : ask;
  // A picture to rebuild: the things it shows, where they are, not a made-up game.
  const scene = !!picture && !GAME_WORDS.test(own);
  if (scene)
    return [
      `You rebuild, in Easy Game Engine, a ${dimension === '2d' ? '2D' : '3D'} scene that looks like the picture the user gave (described in words in the request). It is a scene to walk around in, not a game: no quests, eggs, coins, scores or enemies, and nothing the picture doesn't show.`,
      'Leave questions empty. Write summary (one line: the scene) and parts: 1 to 8 short instructions in build order. First the land the picture shows (like "Shape the ground into rolling hills", "An island in the sea" or "A flat meadow with mountains behind"), then each thing the picture shows with where it is ("A wooden cabin on the right", "A dog on the path in front"), then its plants ("Purple flowers all over the meadow", "Pine trees on the hills"), then the sky and the light ("A sunny sky with a few clouds"), and last the player you walk around as ("The player on the path in front").',
      `The scene has: ${sceneLine()}.`,
    ].join('\n');
  // A change to the game that's there: only what's asked now, not the whole game again.
  if (editing)
    return [
      `You are changing a ${dimension === '2d' ? '2D' : '3D'} game that is already made in Easy Game Engine: the scene below is the game so far${
        editing.earlier.length ? `, made from these requests: ${editing.earlier.map((q) => `"${q}"`).join('; ')}` : ''
      }.`,
      'Plan only what the user asks for now: the new things and the changes. Never a part for something the scene already has (unless it is a change to it), and never the whole game again. Leave questions empty.',
      'Write summary (one line: the change) and parts: 1 to 8 short instructions in build order, each one piece with what and where. A small request (one change) is one part.',
      `The scene has: ${sceneLine()}.`,
    ].join('\n');
  return [
    `You are the designer of a ${dimension === '2d' ? '2D' : '3D'} game being made in Easy Game Engine. Any kind of game is possible.`,
    answered
      ? 'The user answered your questions: do not ask more. Leave questions empty.'
      : 'If the request is too unclear to make something good (like "make a game" with no idea of what kind), ask up to 3 short questions, each with 2 to 4 short answer options, and leave parts empty. If it is clear enough, leave questions empty.',
    'Otherwise write summary (one line: what you will make) and parts: 1 to 8 short instructions in build order, each one piece that can be built on its own, with what and where. Examples of parts: "Shape the ground into rolling hills", "Plant trees on the hills", "A cabin by the path with a door that opens with E", "Coins around the meadow and a score on screen", "An enemy that chases the player". A small request (one change) is one part. Shape the land only when the request is about a place, and make the land it describes (flat fields, hills, mountains, an island, a desert…).',
    `The scene has: ${sceneLine()}.`,
  ].join('\n');
}

/** The understand request's instructions (shared with the training-example generator). */
export function understandSystem(dimension: '3d' | '2d', answered: boolean, ask: string, editing?: Editing): string {
  return `${understandPrompt(dimension, answered, ask, editing)}\nEngine notes:\n${docsFor(ask, 1200)}`;
}

/** A part's instructions: the tools, the scene as it is now, and the docs that part needs. */
export function partSystem(dimension: '3d' | '2d', part: string, summary: string): string {
  return systemPrompt(
    dimension,
    sceneObjects(),
    projectAssets(),
    docsFor(`${part} ${summary}`, 1800),
  );
}

export function partPrompt(summary: string, parts: PartState[], i: number, picture = ''): string {
  const list = parts
    .map(
      (p, k) =>
        `${k + 1}. ${p.text}${p.status === 'done' ? ' (done)' : p.status === 'partly' ? ' (partly done)' : ''}`,
    )
    .join('\n');
  // With a picture: what it shows, so each part matches it (colors, where things are).
  const look = picture ? `\n${picture}\nMake it look like the picture.` : '';
  return `${picture ? 'The scene' : 'The game'}: ${summary}${look}\nAll parts:\n${list}\n\nNow build only part ${i + 1}: "${parts[i].text}". Use object names exactly as they are in the scene.`;
}

const MODEL_HINT =
  'For real things (animals, people, houses, furniture, vehicles, trees, rocks) prefer a real model: {"do":"import","source":"models","query":"<the thing, 1-2 words>","name":"<its name>","at":[x,y,z]} instead of building it out of shapes. Fire, smoke, rain, snow, fireflies, mist and sparkles: {"do":"create","what":"effect","name":"<what it is>","at":[x,y,z]}.';

/** A small change: short, and it says what to do to one thing ("add a tiger", "make it night"). */
export function isSmallChange(request: string): boolean {
  const words = request.trim().split(/\s+/);
  return (
    words.length <= 8 &&
    /^(add|put|place|make|change|move|remove|delete|give|turn|set|paint|color|colour|rename|resize|rotate|scale|swap|replace)\b/i.test(
      request.trim(),
    ) &&
    !/\b(game|level|obby|world|scene|landscape|map)\b/i.test(request)
  );
}

/** Rounds of checking the scene against the request (each can add up to 4 parts). */
const CHECK_ROUNDS = 3;
/** Parts in all, with the ones the checks add. */
const MAX_PARTS = 20;

const plainText = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A missing part that changes what's there ("Make the house wooden"), not a new one. */
const CHANGE_WORDS =
  /\b(make|change|move|turn|fix|recolou?r|paint|bigger|smaller|taller|more|another|second|instead|replace|swap)\b/i;

/** What the scene has, by what each thing is ("house", "horse", "pine trees"). */
function sceneThings(): string[] {
  const out = new Set<string>();
  for (const e of useEditor.getState().engine?.world.all() ?? []) {
    const t = thingOf(e.name);
    if (t) out.add(t);
  }
  return [...out];
}

/** "A small wooden house" when there's a House: a second one. Changes to it ("Make the house red") are fine. */
function alreadyThere(text: string, there: string[]): boolean {
  if (CHANGE_WORDS.test(text)) return false;
  const words = ` ${plainText(text)} `;
  return there.some((t) => words.includes(` ${t} `) || words.includes(` ${t}s `));
}

const PLAYER_PART = /\bplayer\b/i;

/** What a new project starts with (anything else was made by someone). */
const STARTER = new Set(['Sun', 'Sky Light', 'Ground', 'Main Camera', 'Camera', 'Background', 'Global Light']);
const hasWork = () => [...(useEditor.getState().engine?.world.roots ?? [])].some((e) => !STARTER.has(e.name));

const hasPlayer = () =>
  [...(useEditor.getState().engine?.world.all() ?? [])].some((e) =>
    ((e.get('Traits') as { traits?: string[] } | undefined)?.traits ?? []).includes('player'),
  );

const hasTerrain = () =>
  [...(useEditor.getState().engine?.world.all() ?? [])].some((e) => e.has('Terrain'));
/** A new project's flat Ground, untouched (the land replaces it). */
const hasDefaultGround = () => {
  const g = useEditor.getState().engine?.world.findByName('Ground');
  return (
    !!g &&
    !g.parent &&
    !g.children.length &&
    !g.has('Script') &&
    !g.has('Traits') &&
    (g.get('MeshRenderer') as { shape?: string } | undefined)?.shape === 'plane'
  );
};

/**
 * Run a request. Returns 'asked' when it needs answers first (call again with them), else how
 * it went. `answers` are the user's answers to its questions.
 */
export async function runAgent(
  request: string,
  ctx: {
    answers?: string;
    /** What was asked before in this chat (oldest first). */
    earlier?: string[];
    think: boolean;
    realModels?: boolean;
    attachments: string[];
    stopped: () => boolean;
    emit: (e: AgentEvent) => void;
  },
): Promise<{ result: 'asked' | 'done' | 'stopped'; parts: PartState[] }> {
  const s = useEditor.getState();
  const dimension = s.dimension;
  const attached = ctx.attachments.length
    ? `\nThe user attached (now project assets): ${ctx.attachments.join(', ')}.`
    : '';
  const ask = `${request}${ctx.answers ? `\nAnswers: ${ctx.answers}` : ''}${attached}`;

  // ── 1. understand: questions, or a plan ──
  // A small change ("add a tiger", "make the sky red"): just that, one part. No designing a whole
  // game around it (and less work for the graphics chip).
  const small = !pictureOf(ask) && !ctx.attachments.length && isSmallChange(request);
  // Something's built already: this is a change to it (not a new game).
  const editing: Editing | undefined = hasWork() ? { earlier: (ctx.earlier ?? []).slice(-3).map((q) => q.slice(0, 200)) } : undefined;
  let thought: string | undefined;
  let summary = request;
  let texts: string[] = [];
  if (!small) {
    if (ctx.think) {
      const t = await chat({
        system: understandSystem(dimension, true, ask, editing),
        user: `${ask}\n\nThink about how to make this well in this engine: in a few short lines, what it needs and in what order. Plain words.`,
        think: true,
        maxTokens: 700,
        onText: (soFar) => ctx.emit({ type: 'thinking', text: soFar }),
      });
      thought = [t.thought, t.text].filter(Boolean).join('\n').trim() || undefined;
      // Notes are plain words; a model that answered with its plan instead has no notes.
      if (thought && /^[{[]/.test(thought)) thought = undefined;
    }
    if (ctx.stopped()) return { result: 'stopped', parts: [] };
    const u = await chat({
      system: understandSystem(dimension, !!ctx.answers || !!editing, ask, editing),
      user: thought ? `${ask}\n\nYour notes:\n${thought}` : ask,
      schema: understandSchema,
      maxTokens: 500,
      onText: (soFar) => ctx.emit({ type: 'writing', chars: soFar.length }),
    });
    let understood: { questions?: Question[]; summary?: string; parts?: string[] } = {};
    try {
      understood = JSON.parse(u.text);
    } catch {
      // treated as no plan below
    }
    const questions = (understood.questions ?? [])
      .filter((q) => q?.q?.trim())
      .map((q) => ({
        q: q.q.trim(),
        options: (q.options ?? []).filter((o) => o?.trim()).slice(0, 4),
      }));
    if (questions.length && !ctx.answers) {
      ctx.emit({ type: 'questions', questions });
      return { result: 'asked', parts: [] };
    }
    texts = (understood.parts ?? [])
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean);
    summary = understood.summary?.trim() || request;
  }
  // A change: not the things that are already there again (the model likes to remake its game).
  if (editing) {
    const there = sceneThings();
    texts = texts.filter((t) => !alreadyThere(t, there) && !(PLAYER_PART.test(t) && hasPlayer()));
  }
  const parts: PartState[] = (texts.length ? texts : [request])
    .slice(0, 8)
    .map((text) => ({ text, status: 'waiting', steps: [] }));
  ctx.emit({ type: 'plan', summary, parts: parts.map((p) => p.text), thought });

  // ── 2. build, part by part (all of it one undo step) ──
  const history = useEditor.getState().history;
  history?.beginGroup();
  try {
    let r = await buildParts(dimension, summary, ask, parts, 0, ctx);
    // ── 3. before it's done: check it against the request, and build what's missing ──
    const picture = !!pictureOf(ask);
    for (
      let round = 0;
      !small && round < CHECK_ROUNDS && r.result === 'done' && parts.length < MAX_PARTS;
      round++
    ) {
      if (ctx.stopped()) return { result: 'stopped', parts };
      ctx.emit({
        type: 'checking',
        text: round === 0 ? 'Checking it has everything you asked for' : 'Checking again',
      });
      const missing = await whatsMissing(dimension, ask, parts, picture, ctx);
      if (ctx.stopped()) return { result: 'stopped', parts };
      if (!missing.length) break;
      const from = parts.length;
      parts.push(...missing.map((text): PartState => ({ text, status: 'waiting', steps: [] })));
      ctx.emit({ type: 'more', parts: missing });
      r = await buildParts(dimension, summary, ask, parts, from, ctx);
    }
    // Something you can play, even when nobody asked: a player to walk around as.
    if (r.result === 'done' && !hasPlayer() && !ctx.stopped()) {
      const from = parts.length;
      const text =
        dimension === '2d'
          ? 'A player you can run and jump as'
          : 'A player you can walk around as, on the ground in front';
      parts.push({ text, status: 'waiting', steps: [] });
      ctx.emit({ type: 'more', parts: [text] });
      r = await buildParts(dimension, summary, ask, parts, from, ctx);
    }
    return r;
  } finally {
    history?.endGroup('AI assistant');
  }
}

/** What the scene still lacks, compared with the request (and its picture): new parts, or none. */
async function whatsMissing(
  dimension: '3d' | '2d',
  ask: string,
  parts: PartState[],
  picture: boolean,
  ctx: { emit: (e: AgentEvent) => void },
): Promise<string[]> {
  // With a picture, what the scene looks like too, read the same way the picture was.
  const looks = picture ? await lookAtScene() : '';
  const built = parts.filter((p) => p.status !== 'failed').map((p) => p.text);
  const answer = await chat({
    system: checkSystem(dimension),
    user: checkPrompt(ask, describeScene(), looks, built),
    schema: checkSchema,
    maxTokens: 300,
    onText: (soFar) => ctx.emit({ type: 'writing', chars: soFar.length }),
  });
  let missing: unknown[] = [];
  try {
    const parsed = JSON.parse(answer.text) as { missing?: unknown };
    if (Array.isArray(parsed.missing)) missing = parsed.missing;
  } catch {
    // no answer: nothing more to add
  }
  // Not what it already built (or tried to): it would only build it again.
  const seen = new Set(parts.map((p) => plainText(p.text)));
  const there = sceneThings();
  const out: string[] = [];
  for (const m of missing) {
    const text = typeof m === 'string' ? m.trim() : '';
    if (!text || seen.has(plainText(text))) continue;
    if (alreadyThere(text, there)) continue;
    seen.add(plainText(text));
    out.push(text.slice(0, 160));
  }
  return out.slice(0, MAX_PARTS - parts.length);
}

/** Build parts[from…], one after another. */
async function buildParts(
  dimension: '3d' | '2d',
  summary: string,
  ask: string,
  parts: PartState[],
  from: number,
  ctx: { stopped: () => boolean; realModels?: boolean; emit: (e: AgentEvent) => void },
): Promise<{ result: 'done' | 'stopped'; parts: PartState[] }> {
  // Real things look better as real models: a reminder (it rarely did this while learning).
  const modelHint = dimension === '3d' && ctx.realModels ? `\n${MODEL_HINT}` : '';
  for (let i = from; i < parts.length; i++) {
    if (ctx.stopped()) return { result: 'stopped', parts };
    const part = parts[i];
    part.status = 'working';
    ctx.emit({ type: 'part', index: i, part: { ...part } });
    const total: RunReport = { done: [], skipped: [] };
    // Scenery is its weak spot: how to do it well here, when this part is about the land.
    const tips =
      dimension === '3d'
        ? sceneryTips(part.text, ask, { defaultGround: hasDefaultGround(), terrain: hasTerrain() })
        : '';
    const hints = `${modelHint}${tips ? `\n${tips}` : ''}`;
    let feedback = '';
    // First try, then up to two fixes for what failed.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (ctx.stopped()) break;
      const system = partSystem(dimension, part.text, summary);
      const answer = await chat({
        system,
        user: partPrompt(summary, parts, i, pictureOf(ask)) + hints + feedback,
        schema: planSchema(),
        maxTokens: 1500,
        onText: (soFar) => ctx.emit({ type: 'writing', chars: soFar.length }),
      });
      const plan = parsePlan(answer.text);
      if (!plan.steps.length) {
        if (attempt === 0 && !total.done.length) {
          feedback = '\nGive at least one step that does this part.';
          continue;
        }
        break;
      }
      part.steps = [...part.steps, ...plan.steps];
      ctx.emit({ type: 'part', index: i, part: { ...part } });
      const report = await runPlan(plan, {
        stopped: ctx.stopped,
        pause: 60,
        realModels: ctx.realModels && attempt === 0,
      });
      total.done.push(...report.done);
      total.skipped.push(...report.skipped);
      part.report = { ...total };
      ctx.emit({ type: 'part', index: i, part: { ...part } });
      if (!report.skipped.length) break;
      feedback = `\nYou already did: ${report.done.join('; ') || 'nothing yet'}.\nThese steps failed: ${report.skipped.join('; ')}.\nAnswer only with steps that fix them (or do them another way).`;
    }
    // A fixed step counts: failures followed by success at the same thing are fine.
    part.status =
      total.done.length === 0
        ? 'failed'
        : total.skipped.length > total.done.length
          ? 'partly'
          : 'done';
    ctx.emit({ type: 'part', index: i, part: { ...part } });
  }
  return { result: 'done', parts };
}
