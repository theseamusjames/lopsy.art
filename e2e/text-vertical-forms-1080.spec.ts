import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from './fixtures';
import { createDocument, setToolOption, waitForStore } from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';

// #1080: vertical text drew ー, 「」 and 。、 in their horizontal forms. The
// engine now swaps in the font's OpenType `vert` alternate, and without one
// turns Tr characters (「) a quarter clockwise and moves 。、 to the upper right.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A synthetic font: ー is a horizontal bar with a `vert` alternate that is a
// vertical stroke; 「 is an upright corner bracket with no alternate.
const TEST_FONT = path.resolve(__dirname, '../engine-rs/crates/lopsy-wasm/tests/fixtures/LopsyVerticalTest.ttf');
const FAMILY = 'Dela Gothic One';

/** Serve the test font as the catalog's Dela Gothic One TTF, offline. */
async function serveTestFont(page: Page): Promise<void> {
  const cors = { 'access-control-allow-origin': '*' };
  await page.route('https://cdn.jsdelivr.net/**', (route) =>
    route.request().url().toLowerCase().includes('delagothicone')
      ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'font/ttf' }, body: fs.readFileSync(TEST_FONT) })
      : route.fulfill({ status: 404, headers: cors, body: 'not found' }),
  );
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/css' }, body: '' }),
  );
}

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const option = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}`) }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
}

/** Type `text` at a doc point with the Text tool, commit, and return the new layer's id. */
async function typeAndCommit(page: Page, text: string, docX: number, docY: number): Promise<string> {
  await clickAtDoc(page, docX, docY);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(200);
  await page.locator('[data-tool-id="move"]').click();
  await page.waitForTimeout(300);
  const id = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string }> } };
    };
    return store.getState().document.layers.filter((l) => l.type === 'text').at(-1)?.id ?? null;
  });
  expect(id).not.toBeNull();
  return id!;
}

interface Ink {
  width: number;
  height: number;
}

/** Size of the opaque ink in a layer's GPU texture. */
async function inkSize(page: Page, layerId: string): Promise<Ink> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      layerId?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const r = await read(id);
    if (!r) return { width: 0, height: 0 };
    let [minX, minY, maxX, maxY] = [r.width, r.height, -1, -1];
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        if ((r.pixels[(y * r.width + x) * 4 + 3] ?? 0) > 127) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return maxX < 0 ? { width: 0, height: 0 } : { width: maxX - minX + 1, height: maxY - minY + 1 };
  }, layerId);
}

test.describe('vertical text glyph forms (#1080)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'text tool requires a keyboard');
  });

  test('ー becomes a vertical stroke and 「 turns on its side in vertical text', async ({ page }) => {
    await serveTestFont(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);

    await selectTextTool(page);
    await setToolOption(page, 'Size', 100);
    await selectFont(page, FAMILY);

    // Horizontal control: once the font has loaded, ー is a wide, thin bar
    // (the engine's tofu for a missing glyph is taller than wide).
    const horizontal = await typeAndCommit(page, 'ー', 80, 300);
    await expect
      .poll(async () => {
        const ink = await inkSize(page, horizontal);
        return ink.width > 4 * ink.height;
      }, { timeout: 15000 })
      .toBe(true);
    const bar = await inkSize(page, horizontal);

    // The vertical toggle restyles the active text layer, so leave it first.
    await page.locator('[aria-label="Add Layer"]').click();
    await selectTextTool(page);
    const toggle = page.locator('[aria-label="Toggle vertical text"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const verticalBar = await typeAndCommit(page, 'ー', 400, 100);

    await selectTextTool(page);
    const bracket = await typeAndCommit(page, '「', 600, 100);
    await page.screenshot({ path: 'e2e/screenshots/text-vertical-forms-1080.png' });

    // The font's vertical alternate: a stroke as tall as the bar is wide.
    const stroke = await inkSize(page, verticalBar);
    expect(stroke.height).toBeGreaterThan(4 * stroke.width);
    expect(Math.abs(stroke.height - bar.width)).toBeLessThan(bar.width * 0.2);

    // No alternate for 「, so it is turned a quarter clockwise into ﹁.
    const corner = await inkSize(page, bracket);
    expect(corner.width).toBeGreaterThan(corner.height * 1.3);
  });
});
