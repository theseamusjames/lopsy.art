/**
 * #1675 — Scale → Undo → Redo → move must lift the whole scaled object.
 * Without the undo/redo the move drags the live float and the old place is
 * left fully transparent. After the redo there is no float, and the move
 * lifted the redone pixels through the selection, leaving a faint outline
 * (alpha 1–37) of the scaled box behind.
 */
import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  createDocument,
  docToScreen,
  redo,
  selectTool,
  setForegroundColor,
  undo,
  waitForStore,
} from './helpers';

interface Bounds { x: number; y: number; width: number; height: number }

async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  opts: { steps?: number; modifier?: 'Control' } = {},
): Promise<void> {
  const start = await docToScreen(page, from[0], from[1]);
  const end = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  if (opts.modifier) await page.keyboard.down(opts.modifier);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: opts.steps ?? 10 });
  await page.mouse.up();
  if (opts.modifier) await page.keyboard.up(opts.modifier);
  await page.waitForTimeout(150);
}

async function editFill(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[role="menu"][aria-label="Edit"]').getByRole('menuitem', { name: /^Fill$/ }).first().click();
  await page.waitForTimeout(200);
}

/** Non-transparent pixels of `layerId` (document space) inside `region`, and their alpha range. */
async function leftovers(
  page: Page,
  layerId: string,
  region: Bounds,
): Promise<{ count: number; minAlpha: number; maxAlpha: number; first: string | null }> {
  return page.evaluate(async ({ layerId, region }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    const layer = store.getState().document.layers.find((l) => l.id === layerId)!;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(layerId);
    let count = 0;
    let minAlpha = 256;
    let maxAlpha = -1;
    let first: string | null = null;
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        const lx = x - layer.x;
        const ly = y - layer.y;
        if (lx < 0 || ly < 0 || lx >= px.width || ly >= px.height) continue;
        const a = px.pixels[(ly * px.width + lx) * 4 + 3]!;
        if (a === 0) continue;
        if (first === null) first = `(${x},${y}) a=${a}`;
        count++;
        minAlpha = Math.min(minAlpha, a);
        maxAlpha = Math.max(maxAlpha, a);
      }
    }
    return { count, minAlpha, maxAlpha, first };
  }, { layerId, region });
}

/** Opaque black pixels of `layerId` (document space) inside `region`. */
async function opaqueBlack(page: Page, layerId: string, region: Bounds): Promise<number> {
  return page.evaluate(async ({ layerId, region }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    const layer = store.getState().document.layers.find((l) => l.id === layerId)!;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(layerId);
    let n = 0;
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        const lx = x - layer.x;
        const ly = y - layer.y;
        if (lx < 0 || ly < 0 || lx >= px.width || ly >= px.height) continue;
        const i = (ly * px.width + lx) * 4;
        if (px.pixels[i + 3]! === 255 && px.pixels[i]! < 10) n++;
      }
    }
    return n;
  }, { layerId, region });
}

// The scaled box is ~(473, 96)–(650, 450); the move takes it ~360 px left.
const OLD_PLACE: Bounds = { x: 460, y: 80, width: 210, height: 390 };

async function scaleTheBox(page: Page): Promise<string> {
  const layerId = await addLayer(page);
  await selectTool(page, 'marquee-rect');
  await drag(page, [500, 150], [650, 450], { steps: 5 });
  await setForegroundColor(page, 0, 0, 0);
  await editFill(page);

  await selectTool(page, 'move');
  // ⌘/Ctrl on a corner handle scales uniformly about the opposite corner.
  await drag(page, [500, 150], [473, 96], { steps: 12, modifier: 'Control' });
  return layerId;
}

test.describe('Scale → Undo → Redo → move (#1675)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'requires a mouse and keyboard shortcuts');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
  });

  test('moving the redone scale leaves nothing behind', async ({ page }) => {
    const layerId = await scaleTheBox(page);
    expect(await opaqueBlack(page, layerId, OLD_PLACE)).toBeGreaterThan(170 * 345);

    await undo(page);
    await redo(page);
    expect(await opaqueBlack(page, layerId, OLD_PLACE)).toBeGreaterThan(170 * 345);

    await drag(page, [560, 300], [200, 320], { steps: 15 });
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/scale-redo-move-1675.png' });

    // The old place is empty: not even a faint outline of the scaled box.
    const left = await leftovers(page, layerId, OLD_PLACE);
    expect(left.count, `first leftover ${left.first}, alpha ${left.minAlpha}–${left.maxAlpha}`).toBe(0);
    // And the whole box arrived ~360 px left, 20 px down.
    expect(await opaqueBlack(page, layerId, { x: 100, y: 100, width: 220, height: 390 })).toBeGreaterThan(170 * 345);
  });

  test('without the undo/redo the same move leaves nothing behind either', async ({ page }) => {
    const layerId = await scaleTheBox(page);
    await drag(page, [560, 300], [200, 320], { steps: 15 });
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    const left = await leftovers(page, layerId, OLD_PLACE);
    expect(left.count, `first leftover ${left.first}`).toBe(0);
  });
});
