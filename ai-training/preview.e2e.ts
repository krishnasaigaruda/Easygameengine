import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Builds one game of each kind (headless), saves a picture of each, and plays it for a few
 * seconds to catch script errors. For checking the training-game designer by eye:
 *
 *   AI_TEST=preview.e2e.ts OUT=/some/folder npx playwright test -c ai-training/playwright.config.ts
 */

const OUT = process.env.OUT ?? join(process.cwd(), 'ai-training', 'out', 'preview');
const KINDS_3D = ['game-dungeon', 'game-farm', 'game-moon', 'game-winter', 'game-obby', 'game-collect', 'game-maze', 'game-arena', 'game-race', 'game-village', 'game-horror', 'game-island', 'scene-nature', 'game-tower', 'game-targets', 'game-puzzle', 'game-football', 'game-delivery', 'game-rooftops', 'game-tag'];
const KINDS_2D = ['game-2d-lava', 'game-2d-platformer', 'game-2d-climb', 'game-2d-cave', 'game-2d-rush', 'game-2d-key'];
const SEED = Number(process.env.SEED ?? 7);

test('preview the training games', async ({ page }) => {
  test.setTimeout(0);
  mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [kind, kinds] of [['3D', KINDS_3D], ['2D', KINDS_2D]] as const) {
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/');
    await page.locator('.hub-card', { hasText: `New ${kind} project` }).click();
    await page.locator('.hub-modal input').fill(`Preview ${kind}`);
    await page.locator('.hub-modal button', { hasText: 'Create' }).click();
    await page.waitForFunction(() => !!(globalThis as unknown as { __egeAI?: { previewGame?: unknown } }).__egeAI?.previewGame);
    await page.waitForFunction((d) => (globalThis as unknown as { __egeAI: { openDimension(): string } }).__egeAI.openDimension() === d, kind.toLowerCase());
    for (const k of kinds) {
      errors.length = 0;
      const r = await page.evaluate(([kk, s]) => (globalThis as unknown as { __egeAI: { previewGame(k: string, o: { seed: number }): Promise<unknown> } }).__egeAI.previewGame(kk, { seed: s }), [k, SEED] as const);
      await page.waitForTimeout(1500);
      await page.locator('.viewport, .editor-viewport, canvas').first().screenshot({ path: join(OUT, `${k}.png`) });
      await page.keyboard.press('Meta+p');
      await page.waitForTimeout(4000);
      await page.locator('.viewport, .editor-viewport, canvas').first().screenshot({ path: join(OUT, `${k}-play.png`) });
      await page.keyboard.press('Meta+p');
      await page.waitForTimeout(800);
      console.log(`${k}: ${JSON.stringify(r)}\n  errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);
    }
  }
});
