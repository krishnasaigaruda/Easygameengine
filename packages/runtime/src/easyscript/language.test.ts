import { describe, expect, it } from 'vitest';
import { parseJson5, stringifyJson5, Json5Error } from './json5';
import { evaluate, parseExpr, ExprError, safeMember, type ExprScope } from './expr';
import { compileScript } from './compile';

describe('JSON5', () => {
  it('reads comments, unquoted keys, single quotes, trailing commas, hex and Infinity', () => {
    const { value } = parseJson5(`{
      // a comment
      name: 'Coin', /* block */
      "quoted key": 0x1F,
      list: [1, 2, 3,],
      big: -Infinity,
      ok: true,
    }`);
    expect(value).toEqual({ name: 'Coin', 'quoted key': 31, list: [1, 2, 3], big: -Infinity, ok: true });
  });

  it('records where every value is', () => {
    const { locations } = parseJson5('{\n  on: {\n    touch: [\n      { log: "hi" },\n    ],\n  },\n}');
    expect(locations.get('on.touch[0]')?.line).toBe(4);
    expect(locations.get('on.touch[0].log#key')?.line).toBe(4);
  });

  it.each([
    ['{ a: 1 b: 2 }', /forget a comma/],
    ['{ a: "open }', /never closed/],
    ['{ a: 1', /never closed/],
    ['{ a: hello }', /needs quotes/],
    ['{ a: 1, a: 2 }', /appears twice/],
    ['[1, 2', /never closed/],
  ])('friendly error for %s', (src, msg) => {
    expect(() => parseJson5(src)).toThrow(msg);
    try {
      parseJson5(src);
    } catch (e) {
      expect(e).toBeInstanceOf(Json5Error);
      expect((e as Json5Error).line).toBe(1);
    }
  });

  it('stringify round-trips', () => {
    const v = { traits: ['solid'], on: { touch: [{ add: 'game.score', value: 1 }, { destroy: 'self' }] } };
    expect(parseJson5(stringifyJson5(v)).value).toEqual(v);
  });
});

describe('expressions', () => {
  const vars: Record<string, unknown> = { a: 2, b: 3, name: 'Coin', pos: [1, 2, 3], obj: { hp: 5 } };
  const scope: ExprScope = {
    lookup: (n) => vars[n],
    member: (o, p) => safeMember(o, p),
    method: () => undefined,
    call: (n, args) => (n === 'max' ? Math.max(...(args as number[])) : undefined),
  };
  const ev = (s: string) => evaluate(parseExpr(s), scope);

  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['2 ** 3 ** 2', 512],
    ['a < b and b < 4', true],
    ['not (a == 2)', false],
    ['a != 2 || b == 3', true],
    ['a > 1 ? "big" : "small"', 'big'],
    ['"Score: " + a', 'Score: 2'],
    ['pos.y', 2],
    ['pos[2]', 3],
    ['obj.hp - 1', 4],
    ['max(a, b, 10)', 10],
    ['-pos', [-1, -2, -3]],
    ['pos + [1, 1, 1]', [2, 3, 4]],
    ['pos * 2', [2, 4, 6]],
    ['[1, 2] == [1, 2]', true],
    ['missing == null', true],
  ])('%s', (src, expected) => {
    expect(ev(src)).toEqual(expected);
  });

  it('cannot reach the JavaScript world', () => {
    expect(ev('obj.constructor')).toBeUndefined();
    expect(ev('obj.__proto__')).toBeUndefined();
    expect(ev('name.constructor')).toBeUndefined();
  });

  it('explains syntax errors', () => {
    expect(() => parseExpr('a +')).toThrow(ExprError);
    expect(() => parseExpr('a = 3')).toThrow(/to compare use ==/);
    expect(() => parseExpr('"open')).toThrow(/never closed/);
    expect(() => parseExpr('a # b')).toThrow(/can't be used/);
  });
});

describe('compileScript', () => {
  const traits = { traits: ['solid', 'collectible', 'bouncy'], comingSoonTraits: ['climbable'] };

  it('compiles the Coin example', () => {
    const s = compileScript(
      `{
        name: "Coin",
        traits: ["collectible"],
        props: { value: 1 },
        on: {
          touch: [
            { if: "other.is('player')" },
            { add: "game.score", value: "self.value" },
            { log: "Score: {game.score}" },
            { destroy: "self" },
          ],
        },
      }`,
      'coin.easy',
      traits,
    );
    expect(s.diagnostics).toEqual([]);
    expect(s.ok).toBe(true);
    expect(s.name).toBe('Coin');
    expect(s.props).toEqual({ value: 1 });
    expect(s.handlers.touch.map((a) => a.key)).toEqual(['if', 'add', 'log', 'destroy']);
    expect(s.handlers.touch[2].line).toBe(9);
  });

  const problems = (src: string) => compileScript(src, 'x', traits).diagnostics.map((d) => `${d.severity} L${d.line}: ${d.message}`);

  it('suggests fixes for typos, with line numbers', () => {
    const d = problems(`{
      on: {
        tuch: [],
        start: [
          { pley: "coin" },
          { add: "game.score", valeu: 2 },
          { log: "Hi {game.score" },
        ],
      },
      trait: ["solid"],
    }`);
    expect(d).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/error L3: Unknown event "tuch". Did you mean "touch"\?/),
        expect.stringMatching(/error L5: "pley" isn't an action. Did you mean "play"\?/),
        expect.stringMatching(/warning L6: "valeu" isn't used by "add" — did you mean "value"\?/),
        expect.stringMatching(/error L7: A \{ in this text is never closed/),
        expect.stringMatching(/error L10: Unknown section "trait". Did you mean "traits"\?/),
      ]),
    );
  });

  it('catches unknown traits, functions, bad formulas and waits in update', () => {
    const d = problems(`{
      traits: ["colectible", "climbable"],
      on: {
        update: [ { wait: 1 } ],
        start: [ { set: "self.hp", to: "rnadom(1, 2)" }, { if: "self.hp = 3" }, { set: "3", to: 1 } ],
      },
    }`);
    expect(d).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Unknown trait "colectible". Did you mean "collectible"/),
        expect.stringMatching(/warning.*"climbable" trait is coming soon/),
        expect.stringMatching(/can't wait inside on.update/),
        expect.stringMatching(/no function "rnadom" — did you mean "random"/),
        expect.stringMatching(/to compare use ==/),
        expect.stringMatching(/"3" can't be changed/),
      ]),
    );
  });

  it('reports JSON syntax errors with their line', () => {
    const s = compileScript('{\n  on: {\n    start: [ { log: "a" } { log: "b" } ]\n  }\n}');
    expect(s.ok).toBe(false);
    expect(s.diagnostics[0].line).toBe(3);
    expect(s.diagnostics[0].message).toMatch(/comma/);
  });

  it('understands keys, timers, near and messages', () => {
    const s = compileScript(`{
      on: {
        key: { space: [ { log: "jump" } ], e: [ { log: "use" } ], jump: [] },
        timer: [ { every: 2, do: [ { log: "tick" } ] }, { after: 5, do: [] } ],
        near: { distance: 4, do: [ { say: "Hello" } ], leave: [ { say: "Bye" } ] },
        message: { opened: [ { show: "Treasure" } ] },
        enter: [ { log: "in" } ],
      },
    }`);
    expect(s.diagnostics).toEqual([]);
    expect(Object.keys(s.keys)).toEqual(['space', 'e', 'jump']);
    expect(s.timers).toHaveLength(2);
    expect(s.near).toHaveLength(1);
    expect(s.messages.opened[0].params.show).toEqual({ kind: 'target', target: { kind: 'name', name: 'Treasure' } });
    expect(s.handlers.touch).toHaveLength(1); // enter is an alias of touch
  });
});
