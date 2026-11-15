// #1560 — path-bound text is drawn with Canvas2D, point text by the engine.
// Path text used the family's CSS face, so when the browser's copy of a font
// differed from the binary the engine loaded (another build, or a locally
// installed copy), the two kinds of text drew different glyphs.
//
// The network is stubbed so the two sources really differ: the engine's
// "Lobster" binary is the self-hosted Jersey 10 pixel font, while the css2
// stylesheet maps "Lobster" to Inter. Path text must follow the engine.
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, setToolOption, waitForStore } from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';

test.use({
  allowConsoleErrors: [/Failed to load resource|ERR_FAILED|CORS request did not succeed/],
});

async function stubFontNetwork(page: Page, baseURL: string): Promise<void> {
  await page.route('**/font-previews.bin', (route) => route.abort());
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    if (!route.request().url().endsWith('/ofl/lobster/Lobster-Regular.ttf')) {
      await route.abort();
      return;
    }
    const resp = await route.fetch({ url: `${baseURL}/fonts/jersey-10-normal-latin.woff2` });
    await route.fulfill({
      status: 200,
      contentType: 'font/woff2',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: await resp.body(),
    });
  });
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    if (!route.request().url().includes('family=Lobster')) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/css',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: `@font-face {
  font-family: 'Lobster';
  font-style: normal;
  font-weight: 400;
  src: url(${baseURL}/fonts/inter-normal-latin.woff2) format('woff2');
}`,
    });
  });
}

async function pickFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const option = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
  await page.waitForTimeout(200);
}

async function textLayerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string }> } };
    };
    return store.getState().document.layers.filter((l) => l.type === 'text').map((l) => l.id);
  });
}

/** Width and height of a layer's ink (alpha > 64). */
async function inkSize(page: Page, layerId: string): Promise<{ w: number; h: number } | null> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(id);
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3]! <= 64) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    return left === Infinity ? null : { w: right - left + 1, h: bottom - top + 1 };
  }, layerId);
}

async function typeAt(page: Page, x: number, y: number, text: string): Promise<void> {
  await clickAtDoc(page, x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
}

test('#1560 path-bound text draws with the font binary the engine loaded', async ({ page, isMobile, baseURL }) => {
  test.skip(isMobile, 'text tool requires a keyboard');
  await stubFontNetwork(page, baseURL!);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 1400, 900, true);

  await page.keyboard.press('p');
  for (const x of [200, 1200]) {
    const pos = await docToScreen(page, x, 700);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(80);
  }
  await page.locator('[aria-label="Commit path"]').click();
  await page.waitForTimeout(200);

  await selectTextTool(page);
  await pickFont(page, 'Lobster');
  await setToolOption(page, 'Size', 90);
  await typeAt(page, 100, 150, 'KUDU 1');
  const [pointId] = await textLayerIds(page);

  await typeAt(page, 100, 400, 'KUDU 1');
  const pathId = (await textLayerIds(page)).find((id) => id !== pointId)!;
  await page.locator('select[aria-label="Text path"]').selectOption({ index: 1 });

  const point = await inkSize(page, pointId!);
  expect(point).not.toBeNull();

  // Inter draws "KUDU 1" far wider than Jersey 10 at 90 px; the path copy
  // must settle at the engine face's width.
  await expect.poll(async () => {
    const path = await inkSize(page, pathId);
    return path ? Math.abs(path.w - point!.w) / point!.w : 1;
  }, { timeout: 15000 }).toBeLessThan(0.06);
  await page.screenshot({ path: 'e2e/screenshots/path-text-engine-face-1560.png' });

  const path = (await inkSize(page, pathId))!;
  expect(Math.abs(path.h - point!.h) / point!.h).toBeLessThan(0.1);
});
