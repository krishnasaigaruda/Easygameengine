/**
 * EasyScript expressions: `self.health <= 0`, `random(1, 6)`, `other.is('player') and game.score > 3`.
 * Parsed into a small AST and evaluated against a scope — never with eval(), so a shared game
 * can't reach anything the scope doesn't hand it.
 */

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'id'; name: string }
  | { t: 'member'; obj: Expr; prop: string }
  | { t: 'index'; obj: Expr; index: Expr }
  | { t: 'call'; callee: Expr; args: Expr[] }
  | { t: 'unary'; op: '-' | '+' | 'not'; arg: Expr }
  | { t: 'bin'; op: BinOp; l: Expr; r: Expr }
  | { t: 'cond'; test: Expr; a: Expr; b: Expr }
  | { t: 'array'; items: Expr[] };

type BinOp = '+' | '-' | '*' | '/' | '%' | '**' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or';

export class ExprError extends Error {
  /** 0-based character position inside the expression. */
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

// ── tokenizer ───────────────────────────────────────────────────────────────

type Tok =
  | { k: 'num'; v: number; pos: number }
  | { k: 'str'; v: string; pos: number }
  | { k: 'id'; v: string; pos: number }
  | { k: 'op'; v: string; pos: number }
  | { k: 'end'; pos: number };

const OPS = ['===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '(', ')', '[', ']', ',', '.', '?', ':'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ k: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i++;
      let s = '';
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const e = src[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else s += src[i++];
      }
      if (src[i] !== ch) throw new ExprError(`Text starting here is never closed (missing ${ch}).`, start);
      i++;
      out.push({ k: 'str', v: s, pos: start });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op && ch === '=') {
      throw new ExprError('A single = can\'t be used here (to compare use ==; to change a value use the "set" action).', i);
    }
    if (!op) throw new ExprError(`"${ch}" can't be used in an expression.`, i);
    out.push({ k: 'op', v: op, pos: i });
    i += op.length;
  }
  out.push({ k: 'end', pos: src.length });
  return out;
}

// ── parser (precedence climbing) ────────────────────────────────────────────

const BINARY: Record<string, { prec: number; op: BinOp; right?: boolean }> = {
  or: { prec: 1, op: 'or' },
  '||': { prec: 1, op: 'or' },
  and: { prec: 2, op: 'and' },
  '&&': { prec: 2, op: 'and' },
  '==': { prec: 3, op: '==' },
  '===': { prec: 3, op: '==' },
  '!=': { prec: 3, op: '!=' },
  '!==': { prec: 3, op: '!=' },
  '<': { prec: 4, op: '<' },
  '<=': { prec: 4, op: '<=' },
  '>': { prec: 4, op: '>' },
  '>=': { prec: 4, op: '>=' },
  '+': { prec: 5, op: '+' },
  '-': { prec: 5, op: '-' },
  '*': { prec: 6, op: '*' },
  '/': { prec: 6, op: '/' },
  '%': { prec: 6, op: '%' },
  '**': { prec: 8, op: '**', right: true },
};

const cache = new Map<string, Expr>();

/** Parse an expression (cached). Throws ExprError with a friendly message. */
export function parseExpr(src: string): Expr {
  const hit = cache.get(src);
  if (hit) return hit;
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v: string) => {
    const t = peek();
    return t.k === 'op' && t.v === v;
  };
  const expect = (v: string) => {
    const t = next();
    if (t.k !== 'op' || t.v !== v) throw new ExprError(`Expected "${v}" here.`, t.pos);
  };

  function binaryKey(t: Tok): string | null {
    if (t.k === 'op' && BINARY[t.v]) return t.v;
    if (t.k === 'id' && (t.v === 'and' || t.v === 'or')) return t.v;
    return null;
  }

  function parseTernary(): Expr {
    const test = parseBinary(0);
    if (!isOp('?')) return test;
    next();
    const a = parseTernary();
    expect(':');
    const b = parseTernary();
    return { t: 'cond', test, a, b };
  }

  function parseBinary(minPrec: number): Expr {
    let left = parseUnary();
    for (;;) {
      const key = binaryKey(peek());
      if (!key) return left;
      const info = BINARY[key];
      if (info.prec < minPrec) return left;
      next();
      const right = parseBinary(info.right ? info.prec : info.prec + 1);
      left = { t: 'bin', op: info.op, l: left, r: right };
    }
  }

  function parseUnary(): Expr {
    const t = peek();
    if ((t.k === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) || (t.k === 'id' && t.v === 'not')) {
      next();
      const op = t.v === '!' || t.v === 'not' ? 'not' : (t.v as '-' | '+');
      return { t: 'unary', op, arg: parseUnary() };
    }
    return parsePostfix(parsePrimary());
  }

  function parsePostfix(base: Expr): Expr {
    let e = base;
    for (;;) {
      if (isOp('.')) {
        next();
        const t = next();
        if (t.k !== 'id') throw new ExprError('Expected a name after ".".', t.pos);
        e = { t: 'member', obj: e, prop: t.v };
      } else if (isOp('[')) {
        next();
        const index = parseTernary();
        expect(']');
        e = { t: 'index', obj: e, index };
      } else if (isOp('(')) {
        next();
        const args: Expr[] = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(parseTernary());
            if (isOp(',')) next();
            else break;
          }
        }
        expect(')');
        e = { t: 'call', callee: e, args };
      } else return e;
    }
  }

  function parsePrimary(): Expr {
    const t = next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.v };
      case 'str':
        return { t: 'str', v: t.v };
      case 'id':
        if (t.v === 'true' || t.v === 'false') return { t: 'bool', v: t.v === 'true' };
        if (t.v === 'null' || t.v === 'undefined' || t.v === 'none') return { t: 'null' };
        return { t: 'id', name: t.v };
      case 'op':
        if (t.v === '(') {
          const e = parseTernary();
          expect(')');
          return e;
        }
        if (t.v === '[') {
          const items: Expr[] = [];
          if (!isOp(']')) {
            for (;;) {
              items.push(parseTernary());
              if (isOp(',')) next();
              else break;
            }
          }
          expect(']');
          return { t: 'array', items };
        }
        throw new ExprError(`Unexpected "${t.v}".`, t.pos);
      case 'end':
        throw new ExprError('The expression ends too early.', t.pos);
    }
  }

  if (!src.trim()) throw new ExprError('Empty expression.', 0);
  const ast = parseTernary();
  const end = peek();
  if (end.k !== 'end') {
    const hint = end.k === 'op' && end.v === '=' ? ' (to compare use ==)' : '';
    throw new ExprError(`Unexpected "${'v' in end ? end.v : ''}"${hint}.`, end.pos);
  }
  cache.set(src, ast);
  return ast;
}

/** True if the expression is a path you can assign to (self.health, game.score, x). */
export function isAssignable(e: Expr): boolean {
  if (e.t === 'id') return true;
  if (e.t === 'member') return isAssignable(e.obj) || e.obj.t === 'call';
  if (e.t === 'index') return isAssignable(e.obj);
  return false;
}

// ── evaluation ──────────────────────────────────────────────────────────────

/** What expressions can see. The interpreter implements this for a running script. */
export interface ExprScope {
  lookup(name: string): unknown;
  /** Read a property of a value the scope handed out (entities, vectors…). */
  member(obj: unknown, prop: string): unknown;
  /** Call a method on such a value, e.g. other.is('player'). */
  method(obj: unknown, name: string, args: unknown[]): unknown;
  /** Call a global function, e.g. random(1, 6). */
  call(name: string, args: unknown[]): unknown;
}

/** Keys that must never be read from objects (sandbox escape routes). */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor', '__defineGetter__', '__lookupGetter__']);

export function safeMember(obj: unknown, prop: string): unknown {
  if (FORBIDDEN.has(prop) || obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    if (prop === 'length') return obj.length;
    const axis = ['x', 'y', 'z'].indexOf(prop);
    return axis >= 0 ? obj[axis] : undefined;
  }
  if (typeof obj === 'string') return prop === 'length' ? obj.length : undefined;
  if (typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, prop)) {
    return (obj as Record<string, unknown>)[prop];
  }
  return undefined;
}

const toNum = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number(v ?? 0));
export const truthy = (v: unknown): boolean => !!v && !(Array.isArray(v) && v.length === 0);

function add(a: unknown, b: unknown): unknown {
  if (typeof a === 'string' || typeof b === 'string') return `${display(a)}${display(b)}`;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => toNum(x) + toNum(b[i]));
  return toNum(a) + toNum(b);
}

function equal(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return a === b;
}

/** How a value prints in logs / text. */
export function display(v: unknown): string {
  if (v === null || v === undefined) return 'nothing';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v)) return `(${v.map(display).join(', ')})`;
  if (typeof v === 'object' && 'name' in (v as object)) return String((v as { name: unknown }).name);
  return String(v);
}

export function evaluate(e: Expr, scope: ExprScope): unknown {
  switch (e.t) {
    case 'num':
    case 'str':
    case 'bool':
      return e.v;
    case 'null':
      return null;
    case 'id':
      return scope.lookup(e.name);
    case 'member':
      return scope.member(evaluate(e.obj, scope), e.prop);
    case 'index': {
      const obj = evaluate(e.obj, scope);
      const idx = evaluate(e.index, scope);
      if (Array.isArray(obj)) return obj[toNum(idx)];
      return typeof idx === 'string' ? scope.member(obj, idx) : undefined;
    }
    case 'call': {
      const args = e.args.map((a) => evaluate(a, scope));
      if (e.callee.t === 'id') return scope.call(e.callee.name, args);
      if (e.callee.t === 'member') return scope.method(evaluate(e.callee.obj, scope), e.callee.prop, args);
      throw new Error('Only named functions can be called.');
    }
    case 'unary': {
      const v = evaluate(e.arg, scope);
      if (e.op === 'not') return !truthy(v);
      if (Array.isArray(v)) return e.op === '-' ? v.map((x) => -toNum(x)) : v;
      return e.op === '-' ? -toNum(v) : toNum(v);
    }
    case 'cond':
      return truthy(evaluate(e.test, scope)) ? evaluate(e.a, scope) : evaluate(e.b, scope);
    case 'array':
      return e.items.map((i) => evaluate(i, scope));
    case 'bin': {
      if (e.op === 'and') {
        const l = evaluate(e.l, scope);
        return truthy(l) ? evaluate(e.r, scope) : l;
      }
      if (e.op === 'or') {
        const l = evaluate(e.l, scope);
        return truthy(l) ? l : evaluate(e.r, scope);
      }
      const l = evaluate(e.l, scope);
      const r = evaluate(e.r, scope);
      switch (e.op) {
        case '+':
          return add(l, r);
        case '-':
          if (Array.isArray(l) && Array.isArray(r)) return l.map((x, i) => toNum(x) - toNum(r[i]));
          return toNum(l) - toNum(r);
        case '*':
          if (Array.isArray(l)) return l.map((x) => toNum(x) * toNum(r));
          if (Array.isArray(r)) return r.map((x) => toNum(x) * toNum(l));
          return toNum(l) * toNum(r);
        case '/':
          if (Array.isArray(l)) return l.map((x) => toNum(x) / toNum(r));
          return toNum(l) / toNum(r);
        case '%':
          return toNum(l) % toNum(r);
        case '**':
          return toNum(l) ** toNum(r);
        case '==':
          return equal(l, r);
        case '!=':
          return !equal(l, r);
        case '<':
          return toNum(l) < toNum(r);
        case '<=':
          return toNum(l) <= toNum(r);
        case '>':
          return toNum(l) > toNum(r);
        case '>=':
          return toNum(l) >= toNum(r);
      }
    }
  }
}

/** Names used as roots in an expression (for "unknown name" warnings). */
export function rootNames(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.t) {
    case 'id':
      out.add(e.name);
      break;
    case 'member':
      rootNames(e.obj, out);
      break;
    case 'index':
      rootNames(e.obj, out);
      rootNames(e.index, out);
      break;
    case 'call':
      if (e.callee.t !== 'id') rootNames(e.callee, out);
      e.args.forEach((a) => rootNames(a, out));
      break;
    case 'unary':
      rootNames(e.arg, out);
      break;
    case 'bin':
      rootNames(e.l, out);
      rootNames(e.r, out);
      break;
    case 'cond':
      rootNames(e.test, out);
      rootNames(e.a, out);
      rootNames(e.b, out);
      break;
    case 'array':
      e.items.forEach((i) => rootNames(i, out));
      break;
  }
  return out;
}

/** Functions called by name in an expression (to check they exist). */
export function calledFunctions(e: Expr, out = new Set<string>()): Set<string> {
  const walk = (x: Expr): void => {
    if (x.t === 'call') {
      if (x.callee.t === 'id') out.add(x.callee.name);
      else walk(x.callee);
      x.args.forEach(walk);
    } else if (x.t === 'member') walk(x.obj);
    else if (x.t === 'index') {
      walk(x.obj);
      walk(x.index);
    } else if (x.t === 'unary') walk(x.arg);
    else if (x.t === 'bin') {
      walk(x.l);
      walk(x.r);
    } else if (x.t === 'cond') {
      walk(x.test);
      walk(x.a);
      walk(x.b);
    } else if (x.t === 'array') x.items.forEach(walk);
  };
  walk(e);
  return out;
}
