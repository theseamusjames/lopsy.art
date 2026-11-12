/**
 * #1302 — a negative Hue/Saturation Lightness turned pale colours vivid
 * (cream #FFF3DC → #FFAD10 orange) instead of darkening them. Both shaders
 * shifted HSL lightness additively while keeping HSL saturation, and a pale
 * tint has an HSL saturation near 100%.
 *
 * Lightness now blends towards black (negative) or white (positive), as in
 * Photoshop, so cream at −40 becomes a darker beige (~#999284).
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  docToScreen,
  getEditorState,
  getPixelAt,
  applyFilter,
  addAdjustment,
} from './helpers';

type Rgb = [number, number, number];

const CREAM: Rgb = [0xff, 0xf3, 0xdc];
// cream × (1 − 0.4)
const DARK_BEIGE: Rgb = [0x99, 0x92, 0x84];
const PROBE = { x: 200, y: 150 };

async function fillWholeLayer(page: Page, rgb: Rgb): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, 20, 20);
  const end = await docToScreen(page, 380, 280);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await setForegroundColor(page, ...rgb);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function compositeAt(page: Page, x: number, y: number): Promise<Rgb> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
    const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
    const i = ((p.height - 1 - sy) * p.width + sx) * 4;
    return [p.pixels[i] ?? 0, p.pixels[i + 1] ?? 0, p.pixels[i + 2] ?? 0] as Rgb;
  }, { x, y });
}

function expectDarkBeige(rgb: Rgb): void {
  // Before the fix this read #FFAD10: red stayed at 255 and blue collapsed.
  for (let i = 0; i < 3; i++) expect(Math.abs(rgb[i]! - DARK_BEIGE[i]!)).toBeLessThanOrEqual(3);
}

test.describe('Hue/Saturation Lightness keeps pale colours pale (#1302)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'filter dialog and adjustments drawer need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
  });

  test('Filter → Hue/Saturation at Lightness −40 darkens cream to beige', async ({ page }) => {
    await page.locator('[aria-label="Add Layer"]').click();
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await fillWholeLayer(page, CREAM);
    const before = await getPixelAt(page, PROBE.x, PROBE.y, layerId);
    expect([before.r, before.g, before.b]).toEqual(CREAM);

    await applyFilter(page, 'Hue/Saturation...', { Lightness: -40 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/hue-sat-lightness-filter.png' });

    const after = await getPixelAt(page, PROBE.x, PROBE.y, layerId);
    expectDarkBeige([after.r, after.g, after.b]);
  });

  test('a Hue / Saturation node at Lightness −40 darkens a cream group to beige', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = (await getEditorState(page)).document.activeLayerId!;
    await page.locator('[aria-label="Add Layer"]').click();
    await fillWholeLayer(page, CREAM);

    await addAdjustment(page, groupId, 'hue-saturation', { lightness: -40 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/hue-sat-lightness-node.png' });

    expectDarkBeige(await compositeAt(page, PROBE.x, PROBE.y));
  });
});
