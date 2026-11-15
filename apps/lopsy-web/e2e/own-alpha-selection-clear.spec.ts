// A selection loaded from a layer's own alpha (Cmd/Ctrl-click its thumbnail)
// has mask == alpha on anti-aliased edge pixels. Deleting through it, or
// lifting it with a Move, must clear those pixels completely instead of
// leaving an alpha * (1 - alpha) ghost of the soft edge behind.
import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  createDocument,
  docToScreen,
  getEditorState,
  selectTool,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';

const isMac = process.platform === 'darwin';

interface AlphaStats {
  opaque: number;
  partial: number;
}

async function alphaStatsIn(
  page: Page,
  layerId: string,
  region?: { x0: number; y0: number; x1: number; y1: number },
): Promise<AlphaStats> {
  return page.evaluate(async ({ id, region }) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; x?: number; y?: number; pixels: number[] }>;
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id);
    const offsetX = layer?.x ?? 0;
    const offsetY = layer?.y ?? 0;
    const { width, pixels } = await read(id);
    let opaque = 0;
    let partial = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      const a = pixels[i]!;
      if (a === 0) continue;
      const px = ((i - 3) / 4) % width + offsetX;
      const py = Math.floor((i - 3) / 4 / width) + offsetY;
      if (region && (px < region.x0 || px >= region.x1 || py < region.y0 || py >= region.y1)) continue;
      if (a === 255) opaque++;
      else partial++;
    }
    return { opaque, partial };
  }, { id: layerId, region });
}

async function softDiscOnNewLayer(page: Page): Promise<string> {
  await addLayer(page);
  await page.waitForTimeout(50);
  const layerId = (await getEditorState(page)).document.activeLayerId;
  await setForegroundColor(page, 0, 0, 255);

  await selectTool(page, 'marquee-ellipse');
  const start = await docToScreen(page, 60, 60);
  const end = await docToScreen(page, 180, 180);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  await selectTool(page, 'fill');
  await setToolOption(page, 'Tolerance', 255);
  const click = await docToScreen(page, 120, 120);
  await page.mouse.click(click.x, click.y);
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
  return layerId;
}

async function loadLayerAlphaAsSelection(page: Page): Promise<void> {
  const thumbnail = page.locator('[class*="thumbnail"]').first();
  await thumbnail.click({ modifiers: [isMac ? 'Meta' : 'Control'] });
  await page.waitForTimeout(300);
  const isActive = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean } };
    };
    return store.getState().selection.active;
  });
  expect(isActive).toBe(true);
}

test.describe('Selections loaded from a layer\'s own alpha clear cleanly', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('Delete through a Cmd-click selection leaves no soft-edge ghost', async ({ page }) => {
    const layerId = await softDiscOnNewLayer(page);
    const before = await alphaStatsIn(page, layerId);
    // The disc must actually have anti-aliased edge pixels for this to test anything.
    expect(before.partial).toBeGreaterThan(150);

    await loadLayerAlphaAsSelection(page);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    const after = await alphaStatsIn(page, layerId);
    expect(after.opaque + after.partial).toBe(0);
  });

  test('moving a Cmd-click selection leaves nothing at the original spot', async ({ page }) => {
    const layerId = await softDiscOnNewLayer(page);
    const before = await alphaStatsIn(page, layerId);
    expect(before.partial).toBeGreaterThan(150);

    await loadLayerAlphaAsSelection(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    const from = await docToScreen(page, 120, 120);
    const to = await docToScreen(page, 300, 200);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/own-alpha-selection-move.png' });

    const leftBehind = await alphaStatsIn(page, layerId, { x0: 50, y0: 50, x1: 190, y1: 190 });
    expect(leftBehind.opaque + leftBehind.partial).toBe(0);
    const moved = await alphaStatsIn(page, layerId, { x0: 230, y0: 130, x1: 370, y1: 270 });
    expect(moved.opaque).toBeGreaterThan(before.opaque * 0.95);
  });
});
