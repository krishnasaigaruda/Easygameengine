import { expect, test, type Page } from '@playwright/test';

/*
 * Tries the trained model for real (WebGPU, in a fresh headless Chrome): it downloads it from the
 * test server, asks for a few games, answers its questions with the first option, and prints what
 * it planned and built, with a picture of each. Run: AI_TEST=live.e2e.ts OUT=<folder> npx playwright test -c ai-training
 */
test.use({ baseURL: process.env.BASE ?? 'http://[::1]:5310/', launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] } });
test.setTimeout(3_000_000);

const ASKS = (process.env.ASKS ?? 'A small village with houses around a well, trees, and a villager who talks to you|An obby with 8 platforms that get harder, a checkpoint and a finish').split('|');

async function newProject(page: Page, name: string) {
  await page.goto('/');
  await page.locator('.hub-card', { hasText: 'New 3D project' }).click();
  await page.locator('.hub-modal input').fill(name);
  await page.locator('.hub-modal button', { hasText: 'Create' }).click();
  await expect(page.locator('.hub')).toBeHidden();
}

test('the trained model builds games', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
    if (m.text().startsWith('[EGE] reading prompts')) console.log(m.text());
  });
  page.on('worker', (w) => w.on('console', (m) => m.text().startsWith('[EGE]') && console.log(`worker: ${m.text()}`)));
  await newProject(page, 'AI live');
  await page.locator('.toolbar .ai-toggle').click();
  const builder = page.locator('.ai-model', { hasText: 'Easy Game Engine Builder' });
  await builder.click();
  const t0 = Date.now();
  await page.locator('.ai-big').click();
  const box = page.locator('.ai-composer textarea');
  await expect(box).toBeVisible({ timeout: 1_200_000 });
  console.log(`ready after ${Math.round((Date.now() - t0) / 1000)} s`);

  for (const [n, ask] of ASKS.entries()) {
    // Start each game from the same empty scene: undo the last one.
    if (n > 0 && (await page.locator('.ai-ghost', { hasText: 'Undo' }).count())) await page.locator('.ai-ghost', { hasText: 'Undo' }).last().click();
    const t1 = Date.now();
    await box.fill(ask);
    await box.press('Enter');
    const turn = page.locator('.ai-turn').last();
    // Answer questions with the first option; wait until it's built (or gave up).
    for (;;) {
      await page.waitForTimeout(2000);
      const open = turn.locator('.ai-question').filter({ hasNot: page.locator('.ai-chip.on') });
      if ((await open.count()) > 0) {
        for (const q of await open.all()) await q.locator('.ai-chip').first().click();
        continue;
      }
      const busy = await page.locator('.ai-composer.busy').count();
      if (!busy && ((await turn.locator('.ai-summary').count()) || (await turn.locator('.ai-problem').count()))) break;
      if (Date.now() - t1 > 1_200_000) break;
    }
    console.log(`\n== "${ask}" (${Math.round((Date.now() - t1) / 1000)} s)\n${await turn.innerText()}`);
    const names = await page.evaluate(() => [...(globalThis as unknown as { __ege: { world: { all(): Iterable<{ name: string }> } } }).__ege.world.all()].map((e) => e.name));
    console.log(`scene (${names.length}): ${names.join(', ')}`);
    if (process.env.OUT) await page.locator('.area-viewport').screenshot({ path: `${process.env.OUT}/live-${n}.png` });
  }
  console.log(errors.length ? `\nconsole errors:\n${errors.join('\n')}` : '\nno console errors');
});
