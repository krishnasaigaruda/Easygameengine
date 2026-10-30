import { parseJson5, joinPath, Json5Error, type SourceLoc } from './json5';
import { ExprError, calledFunctions, isAssignable, parseExpr, type Expr } from './expr';
import { ACTION_BY_KEY, ACTIONS, EVENT_BY_KEY, EVENTS, FUNCTION_NAMES, INPUT_ACTIONS, didYouMean, keyBinding, type ParamSpec } from './spec';

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** JSON path inside the script, e.g. "on.touch[1]". */
  path: string;
  line: number;
  col: number;
}

/** Text with {formulas} inside, split into literal parts and expressions. */
export type TextTemplate = (string | Expr)[];
/** "self" / "other" / "Door" / "closest('enemy')" */
export type Target = { kind: 'expr'; expr: Expr } | { kind: 'name'; name: string };

export type Param =
  | { kind: 'expr'; expr: Expr }
  | { kind: 'path'; expr: Expr }
  | { kind: 'target'; target: Target }
  | { kind: 'text'; text: TextTemplate }
  | { kind: 'actions'; actions: Action[] }
  | { kind: 'name'; name: string }
  | { kind: 'args'; args: Record<string, Expr> };

export interface Action {
  key: string;
  params: Record<string, Param>;
  /** Where it is in the script, for runtime error messages. */
  path: string;
  line: number;
}

export interface TimerHandler {
  every?: Expr;
  after?: Expr;
  actions: Action[];
}

export interface NearHandler {
  distance: Expr;
  target: Target;
  actions: Action[];
  leave: Action[];
}

export interface CompiledScript {
  name: string;
  traits: string[];
  tags: string[];
  props: Record<string, unknown>;
  /** Simple events (start, update, touch, untouch, click), aliases already merged. */
  handlers: Record<string, Action[]>;
  keys: Record<string, Action[]>;
  messages: Record<string, Action[]>;
  timers: TimerHandler[];
  near: NearHandler[];
  functions: Record<string, Action[]>;
  diagnostics: Diagnostic[];
  /** No errors (warnings are fine). */
  ok: boolean;
}

export interface CompileOptions {
  /** Trait names that exist (to catch typos like "colectible"). */
  traits?: Iterable<string>;
  /** Traits accepted but not implemented yet → warning instead of error. */
  comingSoonTraits?: Iterable<string>;
}

const TOP_LEVEL = ['name', 'description', 'traits', 'tags', 'props', 'on', 'functions'];
const TARGET_WORDS = new Set(['self', 'other', 'player', 'all']);

export function emptyScript(name: string): CompiledScript {
  return {
    name,
    traits: [],
    tags: [],
    props: {},
    handlers: {},
    keys: {},
    messages: {},
    timers: [],
    near: [],
    functions: {},
    diagnostics: [],
    ok: true,
  };
}

/** Parse + check + compile an EasyScript source. Never throws: problems become diagnostics. */
export function compileScript(source: string, name = 'script', options: CompileOptions = {}): CompiledScript {
  const out = emptyScript(name);
  let parsed: { value: unknown; locations: Map<string, SourceLoc> };
  try {
    parsed = parseJson5(source);
  } catch (err) {
    const e = err as Json5Error;
    out.diagnostics.push({ severity: 'error', message: e.message.replace(/^Line \d+, column \d+: /, ''), path: '', line: e.line ?? 1, col: e.col ?? 1 });
    out.ok = false;
    return out;
  }
  new Compiler(out, parsed.locations, options).compileRoot(parsed.value);
  out.ok = !out.diagnostics.some((d) => d.severity === 'error');
  return out;
}

class Compiler {
  private readonly out: CompiledScript;
  private readonly locs: Map<string, SourceLoc>;
  private readonly traits: Set<string> | null;
  private readonly soon: Set<string>;

  constructor(out: CompiledScript, locs: Map<string, SourceLoc>, options: CompileOptions) {
    this.out = out;
    this.locs = locs;
    this.traits = options.traits ? new Set(options.traits) : null;
    this.soon = new Set(options.comingSoonTraits ?? []);
  }

  private report(severity: Diagnostic['severity'], path: string, message: string, keyLoc = false): void {
    const loc = (keyLoc && this.locs.get(`${path}#key`)) || this.locs.get(path) || this.nearestLoc(path);
    this.out.diagnostics.push({ severity, message, path, line: loc?.line ?? 1, col: loc?.col ?? 1 });
  }
  private error(path: string, message: string, keyLoc = false) {
    this.report('error', path, message, keyLoc);
  }
  private warn(path: string, message: string, keyLoc = false) {
    this.report('warning', path, message, keyLoc);
  }

  private nearestLoc(path: string): SourceLoc | undefined {
    for (let p = path; p; p = p.replace(/(\.[^.[]+|\[\d+\])$/, '')) {
      const l = this.locs.get(p);
      if (l) return l;
      if (!/(\.[^.[]+|\[\d+\])$/.test(p)) break;
    }
    return this.locs.get('');
  }

  private line(path: string): number {
    return (this.locs.get(path) ?? this.nearestLoc(path))?.line ?? 1;
  }

  compileRoot(json: unknown): void {
    if (!isObject(json)) {
      this.error('', 'A script must be a { … } block, like { on: { start: [ … ] } }.');
      return;
    }
    for (const key of Object.keys(json)) {
      if (!TOP_LEVEL.includes(key)) {
        const hint = didYouMean(key, TOP_LEVEL);
        this.error(key, `Unknown section "${key}".${hint ? ` Did you mean "${hint}"?` : ` Use one of: ${TOP_LEVEL.join(', ')}.`}`, true);
      }
    }
    if (typeof json.name === 'string') this.out.name = json.name;
    this.compileTraits(json.traits);
    this.compileTags(json.tags);
    this.compileProps(json.props);
    if (json.functions !== undefined) this.compileFunctions(json.functions);
    if (json.on !== undefined) this.compileEvents(json.on);
    this.checkCalls();
  }

  private compileTraits(v: unknown): void {
    if (v === undefined) return;
    const list = typeof v === 'string' ? [v] : v;
    if (!Array.isArray(list)) {
      this.error('traits', 'traits should be a list, like ["solid", "bouncy"].');
      return;
    }
    list.forEach((t, i) => {
      const path = joinPath('traits', i);
      if (typeof t !== 'string') return this.error(path, 'Each trait is a word in quotes, like "solid".');
      if (this.soon.has(t)) {
        this.warn(path, `The "${t}" trait is coming soon (Phase 7) — it won't do anything yet.`);
      } else if (this.traits && !this.traits.has(t)) {
        const hint = didYouMean(t, this.traits);
        return this.error(path, `Unknown trait "${t}".${hint ? ` Did you mean "${hint}"?` : ''}`);
      }
      this.out.traits.push(t);
    });
  }

  private compileTags(v: unknown): void {
    if (v === undefined) return;
    if (!Array.isArray(v) || v.some((t) => typeof t !== 'string')) {
      this.error('tags', 'tags should be a list of words, like ["enemy", "boss"].');
      return;
    }
    this.out.tags.push(...(v as string[]));
  }

  private compileProps(v: unknown): void {
    if (v === undefined) return;
    if (!isObject(v)) {
      this.error('props', 'props should be a { … } block of names and starting values, like { health: 100 }.');
      return;
    }
    for (const [k, val] of Object.entries(v)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        this.error(joinPath('props', k), `"${k}" can't be a variable name — use letters, numbers and _ (no spaces).`, true);
        continue;
      }
      if (isObject(val) && !Array.isArray(val)) {
        this.warn(joinPath('props', k), 'Nested { } values are kept, but most actions only work with numbers, text, true/false or [x, y, z].');
      }
      this.out.props[k] = val;
    }
  }

  private compileFunctions(v: unknown): void {
    if (!isObject(v)) {
      this.error('functions', 'functions should be a { … } block: { name: [ actions ] }.');
      return;
    }
    for (const [name, body] of Object.entries(v)) {
      this.out.functions[name] = this.compileActions(body, joinPath('functions', name));
    }
  }

  private compileEvents(v: unknown): void {
    if (!isObject(v)) {
      this.error('on', 'on should be a { … } block of events, like { start: [ … ], touch: [ … ] }.');
      return;
    }
    for (const [key, body] of Object.entries(v)) {
      const path = joinPath('on', key);
      const spec = EVENT_BY_KEY.get(key);
      if (!spec) {
        const hint = didYouMean(key, EVENTS.map((e) => e.key));
        this.error(path, `Unknown event "${key}".${hint ? ` Did you mean "${hint}"?` : ` Events: ${EVENTS.map((e) => e.key).join(', ')}.`}`, true);
        continue;
      }
      const target = spec.aliasOf ?? key;
      switch (spec.shape) {
        case 'actions': {
          const actions = this.compileActions(body, path);
          (this.out.handlers[target] ??= []).push(...actions);
          if (key === 'update') this.forbidWait(actions, 'update');
          break;
        }
        case 'keyed':
          this.compileKeyed(key, body, path);
          break;
        case 'timers':
          this.compileTimers(body, path);
          break;
        case 'near':
          this.compileNear(body, path);
          break;
      }
    }
  }

  private compileKeyed(event: string, body: unknown, path: string): void {
    if (!isObject(body)) {
      const example = event === 'key' ? '{ space: [ … ], e: [ … ] }' : '{ opened: [ … ] }';
      this.error(path, `on.${event} should be a { … } block like ${example}.`);
      return;
    }
    const target = event === 'key' ? this.out.keys : this.out.messages;
    for (const [name, actions] of Object.entries(body)) {
      const p = joinPath(path, name);
      if (event === 'key' && !keyBinding(name) && !INPUT_ACTIONS.includes(name)) {
        this.error(p, `"${name}" isn't a key name. Use a letter (e), a digit (1), space, enter, shift, up/down/left/right, click, or ${INPUT_ACTIONS.join('/')}.`, true);
        continue;
      }
      (target[name] ??= []).push(...this.compileActions(actions, p));
    }
  }

  private compileTimers(body: unknown, path: string): void {
    const list = Array.isArray(body) ? body : [body];
    list.forEach((t, i) => {
      const p = Array.isArray(body) ? joinPath(path, i) : path;
      if (!isObject(t)) return this.error(p, 'A timer looks like { every: 2, do: [ … ] } or { after: 3, do: [ … ] }.');
      if (t.every === undefined && t.after === undefined) return this.error(p, 'A timer needs "every" (repeat) or "after" (once).');
      this.unknownKeys(t, ['every', 'after', 'do'], p);
      const timer: TimerHandler = { actions: this.compileActions(t.do, joinPath(p, 'do')) };
      if (t.every !== undefined) timer.every = this.expr(t.every, joinPath(p, 'every'));
      if (t.after !== undefined) timer.after = this.expr(t.after, joinPath(p, 'after'));
      this.out.timers.push(timer);
    });
  }

  private compileNear(body: unknown, path: string): void {
    const list = Array.isArray(body) ? body : [body];
    list.forEach((n, i) => {
      const p = Array.isArray(body) ? joinPath(path, i) : path;
      if (!isObject(n)) return this.error(p, 'Use { distance: 3, do: [ … ], leave: [ … ] }.');
      this.unknownKeys(n, ['distance', 'target', 'do', 'leave'], p);
      this.out.near.push({
        distance: this.expr(n.distance ?? 3, joinPath(p, 'distance')),
        target: this.target(n.target ?? 'player', joinPath(p, 'target')),
        actions: this.compileActions(n.do ?? [], joinPath(p, 'do')),
        leave: this.compileActions(n.leave ?? [], joinPath(p, 'leave')),
      });
    });
  }

  compileActions(v: unknown, path: string): Action[] {
    if (v === undefined || v === null) return [];
    if (isObject(v)) {
      const single = this.compileAction(v, path);
      return single ? [single] : [];
    }
    if (!Array.isArray(v)) {
      this.error(path, 'Expected a list of actions: [ { … }, { … } ].');
      return [];
    }
    const out: Action[] = [];
    v.forEach((a, i) => {
      const p = joinPath(path, i);
      if (!isObject(a)) {
        this.error(p, typeof a === 'string' ? `Actions are { … } blocks, e.g. { log: "${a}" }.` : 'Each action is a { … } block.');
        return;
      }
      const compiled = this.compileAction(a, p);
      if (compiled) out.push(compiled);
    });
    return out;
  }

  private compileAction(a: Record<string, unknown>, path: string): Action | null {
    const keys = Object.keys(a);
    const key = keys.find((k) => ACTION_BY_KEY.has(k));
    if (!key) {
      const first = keys[0];
      if (first === undefined) {
        this.error(path, 'This action is empty. Try { log: "Hello" }.');
        return null;
      }
      const hint = didYouMean(first, ACTIONS.map((x) => x.key));
      this.error(joinPath(path, first), `"${first}" isn't an action.${hint ? ` Did you mean "${hint}"?` : ''}`, true);
      return null;
    }
    const spec = ACTION_BY_KEY.get(key)!;
    const allowed = spec.params.map((p) => p.name);
    // Friendly aliases people naturally write.
    const aliases: Record<string, Record<string, string>> = { set: { value: 'to' }, multiply: { value: 'by' } };
    const params: Record<string, Param> = {};
    for (const k of keys) {
      const target = aliases[key]?.[k] ?? k;
      if (!allowed.includes(target)) {
        const other = keys.find((x) => x !== key && ACTION_BY_KEY.has(x) && x === k);
        if (other) {
          this.error(joinPath(path, k), `One action per { } block: split "${key}" and "${k}" into two actions.`, true);
          continue;
        }
        const hint = didYouMean(k, allowed);
        this.warn(joinPath(path, k), `"${k}" isn't used by "${key}"${hint ? ` — did you mean "${hint}"?` : `. It understands: ${allowed.join(', ')}.`}`, true);
        continue;
      }
      const ps = spec.params.find((p) => p.name === target)!;
      const param = this.param(ps, a[k], joinPath(path, k), key);
      if (param) params[target] = param;
    }
    const written = new Set(keys.map((k) => aliases[key]?.[k] ?? k));
    for (const ps of spec.params) {
      // Only complain about params that are missing — not ones written but invalid (already reported).
      if (ps.required && !params[ps.name] && !written.has(ps.name)) {
        this.error(path, `"${key}" needs "${ps.name}" (${ps.label}).`);
      }
    }
    if (spec.comingIn) this.warn(joinPath(path, key), `"${key}" arrives in ${spec.comingIn} — for now it does nothing.`, true);
    return { key, params, path, line: this.line(path) };
  }

  private param(spec: ParamSpec, v: unknown, path: string, action: string): Param | null {
    switch (spec.kind) {
      case 'expr':
        return { kind: 'expr', expr: this.expr(v, path) };
      case 'path': {
        if (typeof v !== 'string') {
          this.error(path, `"${action}" needs the name of something to change, like "self.health" or "game.score".`);
          return null;
        }
        const e = this.expr(v, path);
        if (!isAssignable(e)) {
          this.error(path, `"${v}" can't be changed. Use a variable like self.health or game.score.`);
          return null;
        }
        return { kind: 'path', expr: e };
      }
      case 'target':
        return { kind: 'target', target: this.target(v, path) };
      case 'text':
        return { kind: 'text', text: this.text(v, path) };
      case 'actions':
        return { kind: 'actions', actions: this.compileActions(v, path) };
      case 'name':
        if (typeof v !== 'string' || !v.trim()) {
          this.error(path, 'Expected a name in quotes.');
          return null;
        }
        return { kind: 'name', name: v };
      case 'args': {
        if (!isObject(v)) {
          this.error(path, 'args should be a { … } block, like { amount: 10 }.');
          return null;
        }
        const args: Record<string, Expr> = {};
        for (const [k, x] of Object.entries(v)) args[k] = this.expr(x, joinPath(path, k));
        return { kind: 'args', args };
      }
    }
  }

  /** JSON value → expression. Strings are formulas; numbers/true/false/lists are literals. */
  private expr(v: unknown, path: string): Expr {
    if (typeof v === 'number') return { t: 'num', v };
    if (typeof v === 'boolean') return { t: 'bool', v };
    if (v === null || v === undefined) return { t: 'null' };
    if (Array.isArray(v)) return { t: 'array', items: v.map((x, i) => this.expr(x, joinPath(path, i))) };
    if (typeof v === 'string') {
      try {
        const e = parseExpr(v);
        for (const fn of calledFunctions(e)) {
          if (!FUNCTION_NAMES.has(fn)) {
            const hint = didYouMean(fn, FUNCTION_NAMES);
            this.error(path, `There's no function "${fn}"${hint ? ` — did you mean "${hint}"?` : '.'}`);
          }
        }
        return e;
      } catch (err) {
        const msg = err instanceof ExprError ? err.message : String(err);
        const looksLikeText = /\s/.test(v.trim()) && !/[()+\-*/<>=!.]/.test(v);
        this.error(path, `In "${v}": ${msg}${looksLikeText ? ` If you meant text, wrap it in quotes: "'${v}'".` : ''}`);
        return { t: 'null' };
      }
    }
    this.error(path, 'Expected a number, text, true/false or a formula here.');
    return { t: 'null' };
  }

  private target(v: unknown, path: string): Target {
    if (typeof v !== 'string' || !v.trim()) {
      this.error(path, 'Expected an object: "self", "other", "player" or an object\'s name.');
      return { kind: 'name', name: '' };
    }
    const s = v.trim();
    if (TARGET_WORDS.has(s)) return { kind: 'expr', expr: { t: 'id', name: s } };
    // A formula (has dots, brackets or calls) vs a plain object name like "Big Rock".
    if (/[.()[\]$]/.test(s) || /^(self|other|player|game)\b/.test(s)) return { kind: 'expr', expr: this.expr(s, path) };
    return { kind: 'name', name: s };
  }

  /** "Score: {game.score}" → ['Score: ', <expr>]. Use {{ for a literal {. */
  private text(v: unknown, path: string): TextTemplate {
    if (typeof v !== 'string') return [String(v)];
    const parts: TextTemplate = [];
    let i = 0;
    let buf = '';
    while (i < v.length) {
      if (v.startsWith('{{', i)) {
        buf += '{';
        i += 2;
      } else if (v[i] === '{') {
        const end = v.indexOf('}', i);
        if (end < 0) {
          this.error(path, 'A { in this text is never closed with }.');
          buf += v.slice(i);
          break;
        }
        if (buf) parts.push(buf);
        buf = '';
        parts.push(this.expr(v.slice(i + 1, end), path));
        i = end + 1;
      } else if (v.startsWith('}}', i)) {
        buf += '}';
        i += 2;
      } else buf += v[i++];
    }
    if (buf) parts.push(buf);
    return parts;
  }

  private unknownKeys(obj: Record<string, unknown>, allowed: string[], path: string): void {
    for (const k of Object.keys(obj)) {
      if (allowed.includes(k)) continue;
      const hint = didYouMean(k, allowed);
      this.warn(joinPath(path, k), `"${k}" isn't used here${hint ? ` — did you mean "${hint}"?` : `. Use: ${allowed.join(', ')}.`}`, true);
    }
  }

  private forbidWait(actions: Action[], event: string): void {
    const walk = (list: Action[]) => {
      for (const a of list) {
        if (a.key === 'wait') this.error(a.path, `You can't wait inside on.${event} (it runs every frame). Use a timer instead.`);
        for (const p of Object.values(a.params)) if (p.kind === 'actions') walk(p.actions);
      }
    };
    walk(actions);
  }

  /** Warn about calls to functions this script doesn't define (they may live on other objects). */
  private checkCalls(): void {
    const defined = new Set(Object.keys(this.out.functions));
    const walk = (list: Action[]) => {
      for (const a of list) {
        if (a.key === 'call') {
          const name = a.params.call?.kind === 'name' ? a.params.call.name : '';
          const on = a.params.on;
          const onSelf = !on || (on.kind === 'target' && on.target.kind === 'expr' && on.target.expr.t === 'id' && on.target.expr.name === 'self');
          if (onSelf && name && !defined.has(name) && !this.out.traits.length) {
            const hint = didYouMean(name, defined);
            this.warn(a.path, `This script has no function "${name}"${hint ? ` — did you mean "${hint}"?` : ''}.`);
          }
        }
        for (const p of Object.values(a.params)) if (p.kind === 'actions') walk(p.actions);
      }
    };
    for (const list of Object.values(this.out.handlers)) walk(list);
    for (const list of Object.values(this.out.functions)) walk(list);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
