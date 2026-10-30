import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * The core flows of the editor, end to end: the Hub, making things, undo, playing, templates,
 * 2D, the docs, and exporting a game that then runs on its own.
 */

/** Open the editor and make a new project from the Hub. */
async function newProject(page: Page, kind: '3D' | '2D', name: string): Promise<void> {
  await page.goto('/');
  await page.locator('.hub-card', { hasText: `New ${kind} project` }).click();
  const input = page.locator('.hub-modal input');
  await input.fill(name);
  await page.locator('.hub-modal button', { hasText: 'Create' }).click();
  await expect(page.locator('.hub')).toBeHidden();
  await expect(page.locator('.toolbar')).toContainText(name);
}

const rows = (page: Page) => page.locator('.area-hierarchy .tree-item');

async function create(page: Page, label: string): Promise<void> {
  await page.locator('.area-hierarchy button', { hasText: 'Create' }).click();
  const item = page.locator('.menu button', { hasText: new RegExp(`^${label}$`) });
  // A menu too tall for the window folds its groups into side menus: open them until it shows.
  for (const group of await page.locator('.menu > [aria-haspopup="menu"]').all()) {
    if (await item.isVisible()) break;
    await group.hover();
  }
  await item.click();
}

/** A value from the running engine (the dev build exposes it for tests). */
function engineValue<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const e = globalThis.__ege; return ${fn}; })()`) as Promise<T>;
}

test('the Hub opens first and makes a 3D project', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hub')).toBeVisible();
  await expect(page.locator('.hub-card', { hasText: 'Tutorial 3D' })).toBeVisible();
  await newProject(page, '3D', 'E2E 3D');
  await expect(rows(page).filter({ hasText: 'Ground' })).toHaveCount(1);
  await expect(page.locator('.dimension-badge')).toHaveText('3D');
});

test('objects can be made, undone and redone', async ({ page }) => {
  await newProject(page, '3D', 'E2E Undo');
  await create(page, 'Cube');
  await expect(rows(page).filter({ hasText: /^Cube$/ })).toHaveCount(1);
  await page.locator('.toolbar button[title^="Undo"]').click();
  await expect(rows(page).filter({ hasText: /^Cube$/ })).toHaveCount(0);
  await page.locator('.toolbar button[title^="Redo"]').click();
  await expect(rows(page).filter({ hasText: /^Cube$/ })).toHaveCount(1);
});

test('Play runs the game and Stop puts everything back', async ({ page }) => {
  await newProject(page, '3D', 'E2E Play');
  await create(page, 'Sphere');
  const before = await engineValue<number[]>(page, "e.world.findByName('Sphere').get('Transform').position");
  await page.locator('.toolbar button.play').click();
  await expect(page.locator('.playing-badge')).toBeVisible();
  await engineValue(page, "(e.world.findByName('Sphere').set('Transform', { position: [9, 9, 9] }), 0)");
  await page.locator('.toolbar button[title^="Stop"]').click();
  await expect(page.locator('.playing-badge')).toBeHidden();
  const after = await engineValue<number[]>(page, "e.world.findByName('Sphere').get('Transform').position");
  expect(after).toEqual(before);
});

test('a tutorial template opens with its guide, which ticks steps off', async ({ page }) => {
  await page.goto('/');
  await page.locator('.hub-card', { hasText: 'Tutorial 3D' }).click();
  await page.locator('.hub-modal button', { hasText: 'Create' }).click();
  await expect(page.locator('.guide')).toContainText('Look around');
  await expect(rows(page).filter({ hasText: /^Player$/ })).toHaveCount(1);
  // Step 1 (look around) and step 2 (select the player).
  await engineValue(page, '(e.camera.position.x += 3, 0)');
  await expect(page.locator('.guide')).toContainText('Select the Player');
  await rows(page).filter({ hasText: /^Player$/ }).click();
  await expect(page.locator('.guide')).toContainText('Play the game');
});

test('a 2D player runs on the flat plane', async ({ page }) => {
  await newProject(page, '2D', 'E2E 2D');
  await expect(page.locator('.dimension-badge')).toHaveText('2D');
  await create(page, 'Platform');
  await create(page, '2D Player');
  await engineValue(page, "(e.world.findByName('Platform').set('Sprite', { size: [40, 1] }), e.world.findByName('2D Player').set('Transform', { position: [0, 1.2, 0] }), 0)");
  await page.locator('.toolbar button.play').click();
  await expect(page.locator('.playing-badge')).toBeVisible();
  await page.waitForTimeout(1500);
  const start = await engineValue<number[]>(page, "e.world.findByName('2D Player').get('Transform').position");
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyD');
  const end = await engineValue<number[]>(page, "e.world.findByName('2D Player').get('Transform').position");
  expect(end[0] - start[0]).toBeGreaterThan(1);
  expect(end[2]).toBeCloseTo(0, 3);
});

test('the docs can be searched', async ({ page }) => {
  await page.goto('/');
  await page.locator('.hub-tab', { hasText: 'Learn' }).click();
  await page.getByPlaceholder('Search the docs…').fill('save game');
  await expect(page.locator('.docs-link', { hasText: 'UI, menus & sound' })).toBeVisible();
  await expect(page.locator('.docs-link', { hasText: 'Terrain' })).toHaveCount(0);
  await page.locator('.hub-tab', { hasText: 'Credits' }).click();
  await expect(page.locator('.credits-page')).toContainText('three.js');
});

test('a one-file export runs on its own, straight from disk', async ({ page, context }) => {
  await newProject(page, '3D', 'E2E Export');
  await create(page, 'Cube');
  await page.locator('.toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('.export-format', { hasText: 'One file' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.export-body button', { hasText: 'Download game.html' }).click()]);
  const file = join(mkdtempSync(join(tmpdir(), 'ege-e2e-')), 'game.html');
  await download.saveAs(file);
  const game = await context.newPage();
  await game.goto(`file://${file}`);
  await expect(game.locator('.ege-badge')).toBeVisible({ timeout: 30_000 });
  await expect(game.locator('canvas')).toHaveCount(1);
  expect(await game.title()).toBe('E2E Export');
});

test('a painted tilemap is solid ground in 2D', async ({ page }) => {
  await newProject(page, '2D', 'E2E Tiles');
  await create(page, 'Tilemap');
  await expect(page.locator('.tilemap-tools')).toBeVisible();
  // Paint a row of tiles (y = 0, x = -5…5) by dragging across the viewport.
  const at = (x: number, y: number) =>
    page.evaluate(([wx, wy]) => {
      const e = (globalThis as unknown as { __ege: { camera: { position: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } } }; renderer: { domElement: HTMLCanvasElement } } }).__ege;
      const v = new e.camera.position.constructor(wx, wy, 0).project(e.camera);
      const r = e.renderer.domElement.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    }, [x, y]);
  const [x0, y0] = await at(-4.5, 0.5);
  const [x1] = await at(4.5, 0.5);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 20, y0);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const painted = await engineValue<number>(page, "Object.keys(e.world.findByName('Tilemap').get('Tilemap').cells).length");
  expect(painted).toBeGreaterThanOrEqual(9);
  await page.keyboard.press('Escape'); // stop painting
  await create(page, '2D Player');
  await engineValue(page, "(e.world.findByName('2D Player').set('Transform', { position: [0, 3, 0] }), 0)");
  await page.locator('.toolbar button.play').click();
  await page.waitForTimeout(2500);
  const y = await engineValue<number>(page, "e.world.findByName('2D Player').get('Transform').position[1]");
  // Standing on the tiles (their top is at y = 1), not fallen through.
  expect(y).toBeGreaterThan(0.9);
  expect(y).toBeLessThan(2.5);
});

test('2D extras: top-down walking, parallax backgrounds, pixel-perfect zoom', async ({ page }) => {
  await newProject(page, '2D', 'E2E 2D Extras');
  await create(page, 'Top-down Player');
  await create(page, 'Background');
  await engineValue(page, "(e.settings = { ...e.settings, pixelPerfect: true, pixelsPerUnit: 16 }, e.world.findByName('Top-down Player').set('Transform', { position: [0, 0, 0] }), 0)");
  await page.locator('.toolbar button.play').click();
  await page.waitForTimeout(1200);
  const start = await engineValue<number[]>(page, "e.world.findByName('Top-down Player').get('Transform').position");
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  const end = await engineValue<number[]>(page, "e.world.findByName('Top-down Player').get('Transform').position");
  // Walked up, didn't fall.
  expect(end[1] - start[1]).toBeGreaterThan(1.5);
  // The background (distance 0.7) moves along with the camera, 70% of the way.
  const offset = await engineValue<number[]>(page, "(() => { const b = e.world.findByName('Background'); const m = e.sprites.meshOf(b.id); const c = e.activeCamera.getWorldPosition(m.position.clone()); return [m.position.y, c.y]; })()");
  expect(offset[0]).toBeCloseTo(offset[1] * 0.7, 1);
  // Pixel perfect: a whole number of screen pixels per picture pixel.
  const zoom = await engineValue<number>(page, "(() => { const c = e.activeCamera; const px = e.renderer.domElement.height; return px / (16 * c.userData.flatHeight); })()");
  expect(Math.abs(zoom - Math.round(zoom))).toBeLessThan(0.01);
});

test('the AI step runner builds through editor actions, as one undo step', async ({ page }) => {
  await newProject(page, '3D', 'E2E AI');
  await page.waitForFunction(() => !!(globalThis as unknown as { __egeAI?: unknown }).__egeAI);
  const before = await engineValue<number>(page, '[...e.world.all()].length');
  const report = await page.evaluate(async () => {
    const ai = (globalThis as unknown as { __egeAI: { runPlan(p: object): Promise<{ done: string[]; skipped: string[] }> } }).__egeAI;
    return ai.runPlan({
      reply: 'Here is an obby.',
      steps: [
        { do: 'create', what: 'player', name: 'Hero', at: [0, 1, 0] },
        { do: 'row', what: 'platform', name: 'Step', count: 5, at: [0, 0.5, -4], step: [0, 1, -3] },
        { do: 'row', what: 'coin', name: 'Coin', count: 3, at: [0, 2, -4], step: [0, 1, -3] },
        { do: 'create', what: 'finish', name: 'Goal', at: [0, 5.6, -19] },
        { do: 'set', object: 'Step 3', component: 'MeshRenderer', field: 'color', value: '#ff0000' },
        { do: 'edit', object: 'Step 5', size: [4, 0.5, 4], rotate: [0, 45, 0] },
        { do: 'traits', object: 'Step 2', traits: ['moving-platform'] },
        { do: 'duplicate', object: 'Coin 1', count: 2, step: [2, 0, 0] },
        { do: 'create', what: 'empty', name: 'Coins' },
        { do: 'parent', object: 'Coin 2', to: 'Coins' },
        { do: 'delete', object: 'Coin 3' },
        { do: 'look', look: 'Cartoon' },
        { do: 'settings', field: 'exposure', value: '1.2' },
        { do: 'edit', object: 'Nobody here' },
        { do: 'set', object: 'Hero', component: 'CharacterController', field: 'jumpHeight', value: 'very high' },
      ],
    });
  });
  // Everything but the two impossible steps worked; those say why.
  expect(report.done).toHaveLength(13);
  expect(report.skipped).toHaveLength(2);
  expect(report.skipped[0]).toContain('there is no "Nobody here"');
  expect(report.skipped[1]).toContain('not a number');
  await expect(rows(page).filter({ hasText: /^Hero$/ })).toHaveCount(1);
  const facts = await engineValue<Record<string, unknown>>(
    page,
    `({
      steps: [...e.world.all()].filter((x) => /^Step \\d$/.test(x.name)).length,
      red: e.world.findByName('Step 3').get('MeshRenderer').color,
      turned: e.world.findByName('Step 5').get('Transform').rotation[1],
      moving: e.world.findByName('Step 2').get('Traits').traits.includes('moving-platform'),
      coinsInGroup: e.world.findByName('Coins').children.length,
      coin3: !!e.world.findByName('Coin 3'),
      goalScript: !!e.world.findByName('Goal').get('Script')?.script,
      look: [...e.world.all()].find((x) => x.has('PostProcessing'))?.get('PostProcessing').outline,
      exposure: e.settings.exposure,
    })`,
  );
  expect(facts).toEqual({ steps: 5, red: '#ff0000', turned: 45, moving: true, coinsInGroup: 1, coin3: false, goalScript: true, look: 1, exposure: 1.2 });
  // One undo takes all of it back.
  await page.locator('.toolbar button[title^="Undo"]').click();
  expect(await engineValue<number>(page, '[...e.world.all()].length')).toBe(before);
  await expect(rows(page).filter({ hasText: /^Hero$/ })).toHaveCount(0);
});

test('the AI sidebar: asks, plans, builds part by part, one undo', async ({ page }) => {
  await newProject(page, '3D', 'E2E AI chat');
  await page.waitForFunction(() => !!(globalThis as unknown as { __egeAI?: { setFakeModel?: unknown } }).__egeAI?.setFakeModel);
  // A stand-in model with scripted answers: a question first, then a plan, then each part's steps.
  await page.evaluate(() => {
    const ai = (globalThis as unknown as { __egeAI: { setFakeModel(fn: (o: { system: string; user: string; schema?: { properties?: Record<string, unknown> } }) => string): void } }).__egeAI;
    ai.setFakeModel((o) => {
      if (o.schema?.properties?.questions) {
        if (!o.system.includes('do not ask more')) return JSON.stringify({ questions: [{ q: 'What time of day?', options: ['Day', 'Night'] }], summary: '', parts: [] });
        return JSON.stringify({ questions: [], summary: 'A sunny meadow with coins', parts: ['Make a big flat meadow', 'Put 3 coins on the meadow'] });
      }
      // The check before it's done: once something missing, then nothing.
      if (o.schema?.properties?.missing) {
        const g = globalThis as unknown as { __checks?: number };
        g.__checks = (g.__checks ?? 0) + 1;
        return JSON.stringify({ missing: g.__checks === 1 ? ['A campfire with smoke'] : [] });
      }
      if (o.user.includes('part 4')) return JSON.stringify({ reply: 'ok', steps: [{ do: 'create', what: 'player', at: [0, 1, 4] }] });
      if (o.user.includes('part 3')) return JSON.stringify({ reply: 'ok', steps: [{ do: 'create', what: 'effect', name: 'Campfire Smoke', at: [3, 0.5, 0] }] });
      if (o.user.includes('part 1')) {
        // The model builds the scenery itself, with tips on how to do it well.
        (globalThis as unknown as { __sceneryTips?: boolean }).__sceneryTips = o.user.includes('Tips for scenery');
        return JSON.stringify({ reply: 'ok', steps: [{ do: 'create', what: 'plane', name: 'Meadow', size: [10, 1, 10], color: '#5fae3c' }] });
      }
      return JSON.stringify({ reply: 'ok', steps: [{ do: 'row', what: 'coin', name: 'Coin', count: 3, at: [-2, 1, 0], step: [2, 0, 0] }] });
    });
  });
  await page.locator('.toolbar .ai-toggle').click();
  await expect(page.locator('.ai-empty')).toContainText('What should we make?');
  await page.locator('.ai-empty').screenshot({ path: 'test-results/ai-empty.png' });
  const before = await engineValue<number>(page, '[...e.world.all()].length');
  const box = page.locator('.ai-composer textarea');
  await box.fill('A meadow with some coins');
  await box.press('Enter');
  await expect(page.locator('.ai-question')).toContainText('What time of day?');
  await page.locator('.ai-question .ai-chip', { hasText: 'Day' }).click();
  await expect(page.locator('.ai-part').first()).toContainText('Make a big flat meadow');
  // It checked the scene against the request and built what was missing.
  await expect(page.locator('.ai-part.done')).toHaveCount(4, { timeout: 20_000 });
  await expect(page.locator('.ai-part').nth(2)).toContainText('A campfire with smoke');
  // Nobody asked for one, but there's always a player to walk around as.
  await expect(page.locator('.ai-part').nth(3)).toContainText('A player you can walk around as');
  await expect(page.locator('.ai-summary')).toContainText('Done');
  await page.locator('.ai-sidebar').screenshot({ path: 'test-results/ai-chat.png' });
  expect(await engineValue<number>(page, "[...e.world.all()].filter((x) => /^Coin \\d$/.test(x.name)).length")).toBe(3);
  expect(await engineValue<boolean>(page, "!!e.world.findByName('Meadow')")).toBe(true);
  expect(await engineValue<boolean>(page, "!!e.world.findByName('Campfire Smoke')?.has('ParticleSystem')")).toBe(true);
  expect(await page.evaluate(() => (globalThis as unknown as { __checks?: number }).__checks)).toBe(2);
  expect(await page.evaluate(() => (globalThis as unknown as { __sceneryTips?: boolean }).__sceneryTips)).toBe(true);
  await page.locator('.ai-ghost', { hasText: 'Undo' }).click();
  expect(await engineValue<number>(page, '[...e.world.all()].length')).toBe(before);
});

test('the AI sidebar changes what is there, without making the game again', async ({ page }) => {
  await newProject(page, '3D', 'E2E AI edit');
  await page.waitForFunction(() => !!(globalThis as unknown as { __egeAI?: { setFakeModel?: unknown } }).__egeAI?.setFakeModel);
  await page.evaluate(async () => {
    const ai = (globalThis as unknown as { __egeAI: { runPlan(p: unknown, o: unknown): Promise<unknown>; setFakeModel(fn: (o: { system: string; user: string; schema?: { properties?: Record<string, unknown> } }) => string): void } }).__egeAI;
    await ai.runPlan({ reply: '', steps: [{ do: 'create', what: 'cube', name: 'Barn', at: [0, 1, 0] }, { do: 'create', what: 'player', at: [0, 1, 6] }] }, {});
    ai.setFakeModel((o) => {
      if (o.schema?.properties?.questions) {
        (globalThis as unknown as { __editing?: boolean }).__editing = o.system.includes('already made');
        // A model that likes to remake its game: the barn again, and the shop that was asked for.
        return JSON.stringify({ questions: [], summary: 'A farm with a shop', parts: ['A red barn', 'A shop that sells seeds'] });
      }
      if (o.schema?.properties?.missing) return JSON.stringify({ missing: [] });
      return JSON.stringify({ reply: 'ok', steps: [{ do: 'create', what: 'cube', name: 'Shop', at: [6, 1, 0] }] });
    });
  });
  await page.locator('.toolbar .ai-toggle').click();
  const box = page.locator('.ai-composer textarea');
  await box.fill('add a shop that sells seeds next to the barn');
  await box.press('Enter');
  await expect(page.locator('.ai-summary')).toContainText('Done', { timeout: 20_000 });
  await expect(page.locator('.ai-part')).toHaveCount(1);
  await expect(page.locator('.ai-part').first()).toContainText('A shop that sells seeds');
  expect(await page.evaluate(() => (globalThis as unknown as { __editing?: boolean }).__editing)).toBe(true);
  expect(await engineValue<number>(page, "[...e.world.all()].filter((x) => x.name.startsWith('Barn')).length")).toBe(1);
  expect(await engineValue<boolean>(page, "!!e.world.findByName('Shop')")).toBe(true);
});

/** A model file holding four boxes side by side, like an asset pack of plants. */
function packGltf(): Buffer {
  const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0.5, -0.5, 1, 0.5];
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  const pos = Buffer.from(new Float32Array(p).buffer);
  const ind = Buffer.from(new Uint16Array(idx).buffer);
  const bin = Buffer.concat([pos, ind]);
  const names = ['Fern', 'Grass', 'Grass', 'Flower'];
  return Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'RootNode', children: [1, 2, 3, 4] }, ...names.map((name, i) => ({ name, mesh: 0, translation: [i * 3, 0, 0] }))],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: pos.length },
        { buffer: 0, byteOffset: pos.length, byteLength: ind.length },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
        { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
      ],
    }),
  );
}

test('a model pack opens with an arrow, and one model from it can be placed', async ({ page }) => {
  await newProject(page, '3D', 'E2E Pack');
  await page.locator('.project input[type=file]:not([webkitdirectory])').setInputFiles({ name: 'Plants.gltf', mimeType: 'model/gltf+json', buffer: packGltf() });
  const arrow = page.locator('.asset-open');
  await expect(arrow).toContainText('4');
  await arrow.click();
  const parts = page.locator('.asset-tile.part');
  await expect(parts).toHaveCount(4);
  await expect(parts.locator('.asset-name')).toHaveText(['Fern', 'Grass', 'Grass 1', 'Flower']);
  await expect(parts.first().locator('img')).toBeVisible(); // its own preview
  await parts.nth(3).dblclick();
  await expect(rows(page).filter({ hasText: 'Flower' })).toBeVisible();
  // The model loads in the background.
  await page.waitForFunction(() => {
    const e = (globalThis as unknown as { __ege: { world: { findByName(n: string): unknown }; models: { objectOf(x: unknown): unknown } } }).__ege;
    return !!e.models.objectOf(e.world.findByName('Flower'));
  });
  const shown = await engineValue<{ part: string; meshes: number; x: number; minY: number }>(
    page,
    `(() => {
      const ent = e.world.findByName('Flower');
      const obj = e.models.objectOf(ent);
      let meshes = 0, mesh = null;
      obj.traverse((o) => { if (o.isMesh) { meshes++; mesh = o; } });
      const at = mesh.getWorldPosition(new obj.position.constructor());
      return { part: ent.get('ModelRenderer').part, meshes, x: at.x - ent.get('Transform').position[0], minY: at.y - ent.get('Transform').position[1] };
    })()`,
  );
  expect(shown.part).toBe('0/3');
  expect(shown.meshes).toBe(1); // just the one model, not the whole row
  expect(Math.abs(shown.x)).toBeLessThan(0.01); // where it was dropped, not 9 m off to the side
  expect(Math.abs(shown.minY)).toBeLessThan(0.01);
  await arrow.click();
  await expect(parts).toHaveCount(0);

  // The whole pack: a folded group in the Hierarchy, each model its own object inside.
  await page.locator('.asset-tile', { hasText: 'Plants' }).dblclick();
  const pack = rows(page).filter({ hasText: /^Plants$/ });
  await expect(pack).toBeVisible();
  await expect(rows(page).filter({ hasText: 'Fern' })).toHaveCount(0);
  await pack.locator('.tree-caret').click();
  await expect(rows(page).filter({ hasText: 'Fern' })).toBeVisible();
  const kids = await engineValue<{ name: string; part: string; x: number }[]>(
    page,
    "e.world.findByName('Plants').children.map((c) => ({ name: c.name, part: c.get('ModelRenderer').part, x: c.get('Transform').position[0] }))",
  );
  expect(kids).toEqual([
    { name: 'Fern', part: '0/0', x: 0 },
    { name: 'Grass', part: '0/1', x: 3 },
    { name: 'Grass 1', part: '0/2', x: 6 },
    { name: 'Flower', part: '0/3', x: 9 },
  ]);
  expect(await engineValue<boolean>(page, "e.world.findByName('Plants').has('ModelRenderer')")).toBe(false);
});

test('an attached picture is put into words for the assistant', async ({ page }) => {
  await newProject(page, '3D', 'E2E picture');
  await page.waitForFunction(() => !!(globalThis as unknown as { __egeAI?: { setFakePictureReader?: unknown } }).__egeAI?.setFakePictureReader);
  // Stand-ins: the picture reader "sees" a meadow; the model builds what the request says.
  await page.evaluate(() => {
    const ai = (globalThis as unknown as { __egeAI: { setFakePictureReader(fn: () => string): void; setFakeModel(fn: (o: { user: string; schema?: { properties?: Record<string, unknown> } }) => string): void } }).__egeAI;
    ai.setFakePictureReader(() => 'A log cabin in a meadow with mountains behind.');
    ai.setFakeModel((o) => {
      if (o.schema?.properties?.questions) return JSON.stringify({ questions: [], summary: o.user.includes('log cabin') ? 'A cabin in a meadow' : 'An obby', parts: ['A cabin'] });
      return JSON.stringify({ reply: 'ok', steps: [{ do: 'create', what: 'cube', name: o.user.includes('cabin') ? 'Cabin' : 'Platform' }] });
    });
  });
  await page.locator('.toolbar .ai-toggle').click();
  await page.locator('.ai-composer input[type=file]').setInputFiles({ name: 'meadow.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  const box = page.locator('.ai-composer textarea');
  await box.fill('build what is in the picture');
  await box.press('Enter');
  await expect(page.locator('.ai-ask-seen')).toContainText('A log cabin in a meadow');
  await expect(page.locator('.ai-summary')).toContainText('cabin', { timeout: 20_000 });
});
