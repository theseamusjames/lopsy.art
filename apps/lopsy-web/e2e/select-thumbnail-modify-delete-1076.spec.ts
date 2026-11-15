import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setForegroundColor,
  getEditorState,
  getPixelAt,
  undo,
} from './helpers';

/**
 * #1076 — ⌘-click a layer's own thumbnail, then modify the loaded selection
 * (Shrink…, Grow…, Inverse, Feather…, a nudged outline) and press Delete:
 * the whole layer was wiped, and the selection was swapped back to the
 * layer's original alpha, so a Delete on the next layer wiped that one too.
 *
 * Every test draws the same 200 × 180 rectangle (100,60)–(300,240) on two
 * layers, "Bird" (blue) and "Ink" (red): 36 000 opaque px each.
 */

const RECT = { x0: 100, y0: 60, x1: 300, y1: 240 };
const RECT_PX = 200 * 180;
// Shrink 2 leaves a 196 × 176 core and a 2 px rim.
const CORE_PX = 196 * 176;
const RIM_PX = RECT_PX - CORE_PX;

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function selectDialog(page: Page, item: 'Shrink' | 'Grow' | 'Feather', amount: number): Promise<void> {
  await menu(page, 'Select', new RegExp(`^${item}`));
  const title = item === 'Feather' ? 'Feather Selection' : `${item} Selection`;
  const modal = page.locator(`[role="dialog"][aria-label="${title}"]`);
  await modal.waitFor({ state: 'visible' });
  const input = modal.locator('input[aria-label$=" value"]').first();
  await input.fill(String(amount));
  await input.press('Tab');
  await modal.getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(300);
}

async function pressDeleteOverCanvas(page: Page): Promise<void> {
  const hover = await docToScreen(page, 380, 280);
  await page.mouse.move(hover.x, hover.y);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
}

async function opaqueCount(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const w = window as unknown as {
      __readLayerPixels: (id: string) => Promise<{ pixels: number[] }>;
    };
    const { pixels } = await w.__readLayerPixels(id);
    let n = 0;
    for (let i = 3; i < pixels.length; i += 4) if ((pixels[i] ?? 0) > 128) n++;
    return n;
  }, layerId);
}

async function selectedCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; mask: Uint8ClampedArray | null } };
    };
    const sel = store.getState().selection;
    if (!sel.active || !sel.mask) return 0;
    let n = 0;
    for (const v of sel.mask) if (v > 128) n++;
    return n;
  });
}

async function lastHistoryLabel(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.at(-1)?.label;
  });
}

async function clickRow(page: Page, layerId: string): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"]`).click();
  await page.waitForTimeout(200);
}

async function cmdClickOwnThumbnail(page: Page, layerId: string): Promise<void> {
  const thumbnail = page.locator(`[data-layer-id="${layerId}"] div[class*="thumbnail"]`).first();
  await thumbnail.click({ modifiers: ['ControlOrMeta'] });
  // The prefloat runs on a zero-delay timer after the click.
  await page.waitForTimeout(300);
}

async function drawBirdAndInk(page: Page): Promise<{ bird: string; ink: string }> {
  await createDocument(page, 400, 300, true);
  await page.waitForTimeout(300);
  const bird = (await getEditorState(page)).document.activeLayerId!;
  await setForegroundColor(page, 0, 0, 255);
  await dragMarquee(page, RECT.x0, RECT.y0, RECT.x1, RECT.y1);
  await menu(page, 'Edit', /^Fill$/);
  await deselect(page);

  const ink = await addLayer(page);
  await setForegroundColor(page, 255, 0, 0);
  await dragMarquee(page, RECT.x0, RECT.y0, RECT.x1, RECT.y1);
  await menu(page, 'Edit', /^Fill$/);
  await deselect(page);

  expect(await opaqueCount(page, bird)).toBe(RECT_PX);
  expect(await opaqueCount(page, ink)).toBe(RECT_PX);
  return { bird, ink };
}

test.describe('#1076 a modified thumbnail selection behaves like any other selection', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel and menus need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('Shrink → Inverse → Delete clears only the rim, on this layer and the next', async ({ page }) => {
    const { bird, ink } = await drawBirdAndInk(page);

    await clickRow(page, bird);
    await cmdClickOwnThumbnail(page, bird);
    expect(await selectedCount(page)).toBe(RECT_PX);
    await selectDialog(page, 'Shrink', 2);
    expect(await selectedCount(page)).toBe(CORE_PX);
    await menu(page, 'Select', /^Inverse/);
    expect(await selectedCount(page)).toBe(400 * 300 - CORE_PX);

    await pressDeleteOverCanvas(page);

    // Bird keeps its core; only the 2 px rim is cleared.
    expect(await opaqueCount(page, bird)).toBe(CORE_PX);
    expect((await getPixelAt(page, 200, 150, bird)).a).toBe(255);
    expect((await getPixelAt(page, 100, 60, bird)).a).toBe(0);
    // The inverted selection survives the Delete.
    expect(await selectedCount(page)).toBe(400 * 300 - CORE_PX);
    expect(await lastHistoryLabel(page)).toBe('Clear Selection');

    // The same selection on another layer trims that layer's rim too.
    await clickRow(page, ink);
    await pressDeleteOverCanvas(page);
    expect(await opaqueCount(page, ink)).toBe(CORE_PX);
    expect(await opaqueCount(page, bird)).toBe(CORE_PX);

    await undo(page);
    await undo(page);
    await page.waitForTimeout(200);
    expect(await opaqueCount(page, ink)).toBe(RECT_PX);
    expect(await opaqueCount(page, bird)).toBe(RECT_PX);
  });

  test('Grow → Inverse → Delete leaves both layers untouched', async ({ page }) => {
    const { bird, ink } = await drawBirdAndInk(page);

    await clickRow(page, bird);
    await cmdClickOwnThumbnail(page, bird);
    await selectDialog(page, 'Grow', 2);
    await menu(page, 'Select', /^Inverse/);

    await pressDeleteOverCanvas(page);
    expect(await opaqueCount(page, bird)).toBe(RECT_PX);

    await clickRow(page, ink);
    await pressDeleteOverCanvas(page);
    expect(await opaqueCount(page, ink)).toBe(RECT_PX);
  });

  test('Shrink → Delete leaves the rim, and Edit → Fill then refills only the core', async ({ page }) => {
    const { bird } = await drawBirdAndInk(page);

    await clickRow(page, bird);
    await cmdClickOwnThumbnail(page, bird);
    await selectDialog(page, 'Shrink', 2);

    await pressDeleteOverCanvas(page);
    expect(await opaqueCount(page, bird)).toBe(RIM_PX);
    expect(await selectedCount(page)).toBe(CORE_PX);

    await setForegroundColor(page, 0, 255, 0);
    await menu(page, 'Edit', /^Fill$/);
    expect(await opaqueCount(page, bird)).toBe(RECT_PX);
    const core = await getPixelAt(page, 200, 150, bird);
    expect(core).toMatchObject({ r: 0, g: 255, b: 0, a: 255 });
    const rim = await getPixelAt(page, 100, 60, bird);
    expect(rim).toMatchObject({ r: 0, g: 0, b: 255, a: 255 });
  });

  test('Shrink → Cut leaves the rim on the layer', async ({ page }) => {
    const { bird } = await drawBirdAndInk(page);

    await clickRow(page, bird);
    await cmdClickOwnThumbnail(page, bird);
    await selectDialog(page, 'Shrink', 2);

    const hover = await docToScreen(page, 380, 280);
    await page.mouse.move(hover.x, hover.y);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ControlOrMeta+x');
    await page.waitForTimeout(250);
    expect(await opaqueCount(page, bird)).toBe(RIM_PX);
    expect(await selectedCount(page)).toBe(CORE_PX);
  });

  test('a selection outline nudged with the marquee tool deletes the nudged area', async ({ page }) => {
    const { bird } = await drawBirdAndInk(page);

    await clickRow(page, bird);
    await cmdClickOwnThumbnail(page, bird);
    await page.keyboard.press('m');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(200);

    await pressDeleteOverCanvas(page);
    // Only the 190 × 180 overlap with the nudged outline is cleared.
    expect(await opaqueCount(page, bird)).toBe(10 * 180);
    expect((await getPixelAt(page, 105, 150, bird)).a).toBe(255);
    expect((await getPixelAt(page, 200, 150, bird)).a).toBe(0);
  });

  test('Move-tool arrow nudges still carry the loaded pixels', async ({ page }) => {
    const { bird } = await drawBirdAndInk(page);

    await clickRow(page, bird);
    await cmdClickOwnThumbnail(page, bird);
    await page.keyboard.press('v');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await deselect(page);

    expect(await opaqueCount(page, bird)).toBe(RECT_PX);
    expect((await getPixelAt(page, 101, 150, bird)).a).toBe(0);
    expect((await getPixelAt(page, 302, 150, bird)).a).toBe(255);
  });
});
