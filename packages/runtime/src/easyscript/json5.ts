/**
 * A small JSON5 parser that remembers where every value came from, so EasyScript errors can say
 * "Line 7: …". Supports comments, unquoted keys, single-quoted strings, trailing commas, hex
 * numbers, +/-Infinity and NaN.
 */

export interface SourceLoc {
  line: number; // 1-based
  col: number; // 1-based
  offset: number;
}

export interface Json5Result {
  value: unknown;
  /** Path ("on.touch[0].add") → location of that value. "" is the root. */
  locations: Map<string, SourceLoc>;
}

export class Json5Error extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, loc: SourceLoc) {
    super(`Line ${loc.line}, column ${loc.col}: ${message}`);
    this.line = loc.line;
    this.col = loc.col;
  }
}

export function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

const ID_START = /[A-Za-z_$À-￿]/;
const ID_PART = /[A-Za-z0-9_$À-￿-]/;

export function parseJson5(text: string): Json5Result {
  let i = 0;
  let line = 1;
  let col = 1;
  const locations = new Map<string, SourceLoc>();

  const here = (): SourceLoc => ({ line, col, offset: i });
  const fail = (msg: string, loc: SourceLoc = here()): never => {
    throw new Json5Error(msg, loc);
  };
  const peek = () => text[i];
  const advance = (): string => {
    const ch = text[i++];
    if (ch === '\n') {
      line++;
      col = 1;
    } else col++;
    return ch;
  };

  function skipSpace(): void {
    for (;;) {
      const ch = peek();
      if (ch === undefined) return;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '﻿' || ch === ' ') {
        advance();
      } else if (ch === '/' && text[i + 1] === '/') {
        while (peek() !== undefined && peek() !== '\n') advance();
      } else if (ch === '/' && text[i + 1] === '*') {
        const start = here();
        advance();
        advance();
        while (!(peek() === '*' && text[i + 1] === '/')) {
          if (peek() === undefined) fail('This comment is never closed (missing */).', start);
          advance();
        }
        advance();
        advance();
      } else return;
    }
  }

  function parseValue(path: string): unknown {
    skipSpace();
    const loc = here();
    locations.set(path, loc);
    const ch = peek();
    if (ch === undefined) return fail('The file ended too early — a value is missing.');
    if (ch === '{') return parseObject(path);
    if (ch === '[') return parseArray(path);
    if (ch === '"' || ch === "'") return parseString();
    if (ch === '-' || ch === '+' || ch === '.' || (ch >= '0' && ch <= '9')) return parseNumber();
    if (ID_START.test(ch)) {
      const word = readIdentifier();
      if (word === 'true') return true;
      if (word === 'false') return false;
      if (word === 'null') return null;
      if (word === 'Infinity') return Infinity;
      if (word === 'NaN') return NaN;
      return fail(`"${word}" isn't a value. Text needs quotes: "${word}".`, loc);
    }
    return fail(`Unexpected "${ch}".`);
  }

  function readIdentifier(): string {
    let s = '';
    while (peek() !== undefined && ID_PART.test(peek())) s += advance();
    // Allow dashed words like load-scene as keys, but not a trailing dash.
    return s;
  }

  function parseString(): string {
    const start = here();
    const quote = advance();
    let s = '';
    for (;;) {
      const ch = peek();
      if (ch === undefined || ch === '\n') {
        fail(`This text is never closed — add a ${quote} at the end.`, start);
      }
      advance();
      if (ch === quote) return s;
      if (ch === '\\') {
        const e = advance();
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };
        if (e === undefined) fail('Text ended in the middle of an escape.', start);
        else if (e in map) s += map[e];
        else if (e === '\n') continue; // line continuation
        else if (e === 'u') {
          const hex = text.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Bad \\u escape (needs 4 hex digits).');
          for (let k = 0; k < 4; k++) advance();
          s += String.fromCharCode(parseInt(hex, 16));
        } else if (e === 'x') {
          const hex = text.slice(i, i + 2);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail('Bad \\x escape (needs 2 hex digits).');
          advance();
          advance();
          s += String.fromCharCode(parseInt(hex, 16));
        } else s += e;
      } else s += ch;
    }
  }

  function parseNumber(): number {
    const start = here();
    let s = '';
    if (peek() === '-' || peek() === '+') s += advance();
    if (text.startsWith('Infinity', i)) {
      for (let k = 0; k < 8; k++) advance();
      return s === '-' ? -Infinity : Infinity;
    }
    if (text.startsWith('NaN', i)) {
      for (let k = 0; k < 3; k++) advance();
      return NaN;
    }
    if (peek() === '0' && (text[i + 1] === 'x' || text[i + 1] === 'X')) {
      advance();
      advance();
      let hex = '';
      while (/[0-9a-fA-F]/.test(peek() ?? '')) hex += advance();
      if (!hex) fail('A hex number needs digits after 0x.', start);
      return (s === '-' ? -1 : 1) * parseInt(hex, 16);
    }
    while (/[0-9.eE+-]/.test(peek() ?? '')) {
      // stop at a +/- that isn't part of an exponent
      const ch = peek();
      if ((ch === '+' || ch === '-') && !/[eE]/.test(s[s.length - 1] ?? '')) break;
      s += advance();
    }
    const n = Number(s);
    if (s === '' || s === '-' || s === '+' || Number.isNaN(n)) fail(`"${s}" isn't a valid number.`, start);
    return n;
  }

  function parseArray(path: string): unknown[] {
    const open = here();
    advance(); // [
    const out: unknown[] = [];
    for (;;) {
      skipSpace();
      if (peek() === undefined) fail('This list is never closed — add a ] at the end.', open);
      if (peek() === ']') {
        advance();
        return out;
      }
      out.push(parseValue(joinPath(path, out.length)));
      skipSpace();
      if (peek() === ',') {
        advance();
        continue;
      }
      if (peek() === ']') {
        advance();
        return out;
      }
      if (peek() === undefined) fail('This list is never closed — add a ] at the end.', open);
      fail('Expected a comma between list items, or ] to end the list.');
    }
  }

  function parseObject(path: string): Record<string, unknown> {
    const open = here();
    advance(); // {
    const out: Record<string, unknown> = {};
    for (;;) {
      skipSpace();
      if (peek() === undefined) fail('This { is never closed — add a } at the end.', open);
      if (peek() === '}') {
        advance();
        return out;
      }
      const keyLoc = here();
      let key: string;
      if (peek() === '"' || peek() === "'") key = parseString();
      else if (ID_START.test(peek())) key = readIdentifier();
      else if (/[0-9]/.test(peek())) key = String(parseNumber());
      else return fail(`Expected a name before the colon, found "${peek()}".`);
      skipSpace();
      if (peek() !== ':') fail(`Expected ":" after "${key}".`);
      advance();
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        fail(`"${key}" appears twice here — the second one would replace the first.`, keyLoc);
      }
      const childPath = joinPath(path, key);
      locations.set(`${childPath}#key`, keyLoc);
      out[key] = parseValue(childPath);
      skipSpace();
      if (peek() === ',') {
        advance();
        continue;
      }
      if (peek() === '}') {
        advance();
        return out;
      }
      if (peek() === undefined) fail('This { is never closed — add a } at the end.', open);
      fail('Expected a comma between items, or } to end this block. Did you forget a comma on the line above?');
    }
  }

  const value = parseValue('');
  skipSpace();
  if (i < text.length) fail('There is extra text after the end of the script.');
  return { value, locations };
}

/** Pretty JSON5 output (used by the visual rule builder to write scripts). */
export function stringifyJson5(value: unknown, indent = 2): string {
  const pad = (n: number) => ' '.repeat(n * indent);
  const key = (k: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k));
  const write = (v: unknown, depth: number): string => {
    if (v === null || typeof v !== 'object') return typeof v === 'string' ? JSON.stringify(v) : String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const simple = v.every((x) => x === null || typeof x !== 'object');
      if (simple && v.length <= 6) return `[${v.map((x) => write(x, depth)).join(', ')}]`;
      return `[\n${v.map((x) => pad(depth + 1) + write(x, depth + 1)).join(',\n')},\n${pad(depth)}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const inline = entries.every(([, x]) => x === null || typeof x !== 'object') && entries.length <= 3;
    if (inline && depth > 0) return `{ ${entries.map(([k, x]) => `${key(k)}: ${write(x, depth)}`).join(', ')} }`;
    return `{\n${entries.map(([k, x]) => `${pad(depth + 1)}${key(k)}: ${write(x, depth + 1)}`).join(',\n')},\n${pad(depth)}}`;
  };
  return write(value, 0);
}
