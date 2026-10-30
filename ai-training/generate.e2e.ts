import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Makes the assistant's training examples from the engine itself, in a real headless editor:
 * every answer is run there and kept only if it works. Writes ai-training/data/train.jsonl and
 * eval.jsonl (5% held back to measure the trained model on).
 *
 *   npm run ai:examples                          (small edits and whole games)
 *   EXAMPLES=20000 GAMES=6000 npm run ai:examples  (more: EXAMPLES small edits, GAMES whole games)
 *   GAMES=40 EXAMPLES=0 KEEP=0 npm run ai:examples (a quick check of the game designer: prints what failed)
 */

const PER_PROJECT = Number(process.env.EXAMPLES ?? 6000) / 4;
const GAMES_PER_PROJECT = Math.round(Number(process.env.GAMES ?? 4000) / 4);
const WRITE = process.env.KEEP !== '0';

async function make(page: import('@playwright/test').Page, kind: '3D' | '2D', seed: number) {
  // Start at the Hub each time (a reload would otherwise reopen the last project).
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await page.locator('.hub-card', { hasText: `New ${kind} project` }).click();
  await page.locator('.hub-modal input').fill(`Training ${kind} ${seed}`);
  await page.locator('.hub-modal button', { hasText: 'Create' }).click();
  await page.waitForFunction(() => !!(globalThis as unknown as { __egeAI?: { generateGames?: unknown } }).__egeAI?.generateGames);
  await page.waitForFunction((d) => (globalThis as unknown as { __egeAI: { openDimension(): string } }).__egeAI.openDimension() === d, kind.toLowerCase());
  return page.evaluate(
    async ([count, games, s]) => {
      type Made = { examples: unknown[]; tried: number; failed?: Record<string, number> };
      const ai = (globalThis as unknown as { __egeAI: { generateExamples(n: number, o: { seed: number }): Promise<Made>; generateGames(n: number, o: { seed: number }): Promise<Made> } }).__egeAI;
      const small = count ? await ai.generateExamples(count, { seed: s }) : { examples: [], tried: 0 };
      const whole = games ? await ai.generateGames(games, { seed: s * 1000 }) : { examples: [], tried: 0, failed: {} };
      return { examples: [...small.examples, ...whole.examples], tried: small.tried + whole.tried, games: whole.tried, gameExamples: whole.examples.length, failed: whole.failed ?? {} };
    },
    [PER_PROJECT, GAMES_PER_PROJECT, seed] as const,
  );
}

test('make training examples', async ({ page }) => {
  test.setTimeout(0);
  const all: unknown[] = [];
  let tried = 0;
  // Two 3D and two 2D projects, different seeds (different scenes and requests).
  for (const [kind, seed] of [['3D', 1], ['3D', 2], ['2D', 3], ['2D', 4]] as const) {
    const r = await make(page, kind, seed);
    all.push(...r.examples);
    tried += r.tried;
    console.log(`${kind} (seed ${seed}): ${r.examples.length} examples (${r.tried} tried; ${r.games} games gave ${r.gameExamples})`);
    const fails = Object.entries(r.failed).sort((a, b) => b[1] - a[1]);
    if (fails.length) console.log('  games that failed, by step:\n' + fails.slice(0, 25).map(([why, n]) => `    ${n}x ${why}`).join('\n'));
  }
  if (!WRITE) return;
  // Shuffle, then hold 5% back for testing.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const held = Math.max(20, Math.round(all.length * 0.05));
  const dir = join(process.cwd(), 'ai-training', 'data');
  mkdirSync(dir, { recursive: true });
  const line = (e: unknown) => JSON.stringify(e);
  writeFileSync(join(dir, 'eval.jsonl'), all.slice(0, held).map(line).join('\n') + '\n');
  writeFileSync(join(dir, 'train.jsonl'), all.slice(held).map(line).join('\n') + '\n');
  console.log(`\nWrote ${all.length - held} training and ${held} test examples to ai-training/data/ (${tried} tasks tried).`);
});
