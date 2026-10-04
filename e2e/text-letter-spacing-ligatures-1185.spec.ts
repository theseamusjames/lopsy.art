import { test, expect, type Page } from './fixtures';
import { createDocument, getEditorState, waitForStore } from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';
import { serveFontsOffline } from './font-fixtures';

// #1185: letter spacing spread every letter apart except fi / fl, which the
// font's `liga` feature kept fused into one glyph. IM Fell English (served
// from a local fixture) has fi and fl ligatures.

interface InkProfile {
  /** Doc-space x of the leftmost / rightmost opaque column. */
  left: number;
  right: number;
  /** Longest run of fully transparent columns between the two. */
  widestGap: number;
}

async function inkProfile(page: Page, layerId: string): Promise<InkProfile> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readLayerPixels as (layerId?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number }> } };
    };
    const layerX = store.getState().document.layers.find((l) => l.id === id)!.x;
    const { width, height, pixels } = await read(id);
    const inked: boolean[] = [];
    for (let x = 0; x < width; x++) {
      let isInked = false;
      for (let y = 0; y < height && !isInked; y++) {
        isInked = (pixels[(y * width + x) * 4 + 3] ?? 0) > 20;
      }
      inked.push(isInked);
    }
    const first = inked.indexOf(true);
    const last = inked.lastIndexOf(true);
    let widestGap = 0;
    let run = 0;
    for (let x = first; x <= last; x++) {
      run = inked[x] ? 0 : run + 1;
      widestGap = Math.max(widestGap, run);
    }
    return { left: layerX + first, right: layerX + last, widestGap };
  }, layerId);
}

async function setTextValue(page: Page, label: string, value: number): Promise<void> {
  const input = page.locator(`[aria-label="${label} value"]`).first();
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(300);
}

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.waitForFunction(
    (f) => {
      const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
      return fn ? fn(f) : false;
    },
    family,
    { timeout: 20000 },
  );
  await page.waitForTimeout(500);
}

test.describe('Letter spacing turns off optional ligatures (#1185)', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'font picker lives in the desktop options bar');
    await serveFontsOffline(page);
  });

  test('fi spreads apart by the letter spacing like any other pair', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 400, true);

    await selectTextTool(page);
    await clickAtDoc(page, 100, 200);
    await page.keyboard.type('fi');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);
    const layerId = (await getEditorState(page)).document.layers.find((l) => l.type === 'text')!.id;

    await selectFont(page, 'IM Fell English');
    await setTextValue(page, 'Size', 120);
    const tight = await inkProfile(page, layerId);
    await page.screenshot({ path: 'e2e/screenshots/text-ligature-fi-no-spacing.png' });
    // One fused fi glyph: no clear column between f and i.
    expect(tight.widestGap).toBeLessThan(5);

    await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
    await setTextValue(page, 'Letter spacing', 30);
    const wide = await inkProfile(page, layerId);
    await page.screenshot({ path: 'e2e/screenshots/text-ligature-fi-spaced.png' });

    // f and i are two glyphs now, so the single 30 px gap between them
    // opens a channel of empty columns (narrower than 30: the arm of the f
    // overhangs its advance) and widens the ink by about
    // that much. The fused ligature had no gap to widen: the ink stayed put.
    expect(wide.widestGap).toBeGreaterThan(10);
    const growth = (wide.right - wide.left) - (tight.right - tight.left);
    expect(growth).toBeGreaterThan(20);
    expect(growth).toBeLessThan(45);
    expect(Math.abs(wide.left - tight.left)).toBeLessThanOrEqual(2);
  });
});
