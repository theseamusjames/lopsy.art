// Regression test for #997 — a Google font whose css2 stylesheet failed to load
// once was never retried: the rejected promise stayed cached (and the dead
// <link> stayed in <head>), so re-picking the font did nothing and path-bound
// text (rendered with Canvas2D from DOM fonts) stayed in the fallback face.
//
// Network is fully stubbed: the first Lobster stylesheet request is aborted,
// later ones get a stub stylesheet that maps "Lobster" to the self-hosted
// Jersey 10 pixel font, whose glyphs look nothing like the fallback serif.
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, waitForStore } from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';

const STYLESHEET = /fonts\.googleapis\.com\/css2\?family=Lobster:wght@400&display=swap/;

// One regex: Playwright reads a two-element array here as [value, options].
test.use({ allowConsoleErrors: [/Failed to load font: Lobster|Failed to load resource|ERR_FAILED/] });

interface StylesheetLog {
  requests: number;
}

async function stubFontNetwork(page: Page, baseURL: string): Promise<StylesheetLog> {
  const log: StylesheetLog = { requests: 0 };
  // Keep the picker previews and the engine binary off the network; neither
  // affects the DOM stylesheet under test.
  await page.route('**/font-previews.bin', (route) => route.abort());
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    const request = route.request();
    if (!STYLESHEET.test(request.url()) || request.resourceType() !== 'stylesheet') {
      await route.abort();
      return;
    }
    log.requests++;
    if (log.requests === 1) {
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
  src: url(${baseURL}/fonts/jersey-10-normal-latin.woff2) format('woff2');
}`,
    });
  });
  return log;
}

async function pickFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const option = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
  await page.waitForTimeout(200);
}

async function drawOpenPath(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  await page.keyboard.press('p');
  for (const pt of points) {
    const pos = await docToScreen(page, pt.x, pt.y);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}

async function readLayer(page: Page, layerId: string): Promise<number[]> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id: string,
    ) => Promise<{ pixels: number[] }>;
    const { pixels } = await read(id);
    return pixels.filter((_, i) => i % 4 === 3);
  }, layerId);
}

function alphaDiff(a: number[], b: number[]): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 32) diff++;
  return diff;
}

test('#997 a failed Google font stylesheet is retried and path text re-renders', async ({ page, isMobile, baseURL }) => {
  test.skip(isMobile, 'text tool requires a keyboard');
  const log = await stubFontNetwork(page, baseURL!);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, true);

  await drawOpenPath(page, [{ x: 30, y: 180 }, { x: 370, y: 180 }]);

  await selectTextTool(page);
  await clickAtDoc(page, 60, 80);
  // No letter of "Lobster" appears here, so a name-only preview face can't
  // stand in for the real one.
  await page.keyboard.type('WAVY HUGZ');
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(150);

  const layerId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string }> } };
    };
    return store.getState().document.layers.find((l) => l.type === 'text')!.id;
  });
  const pathSelect = page.locator('select[aria-label="Text path"]');
  await pathSelect.selectOption({ index: 1 });
  await page.waitForTimeout(200);

  await pickFont(page, 'Lobster');
  await expect.poll(() => log.requests).toBe(1);
  await page.waitForTimeout(300);
  const fallback = await readLayer(page, layerId);
  expect(fallback.filter((a) => a > 10).length).toBeGreaterThan(100);
  await page.screenshot({ path: 'e2e/screenshots/text-google-font-retry-fallback.png' });

  // Re-pick the font: the loader must request the stylesheet again.
  await pickFont(page, 'Inter');
  await pickFont(page, 'Lobster');
  await expect.poll(() => log.requests).toBe(2);

  // Only the latest Lobster stylesheet remains; the failed <link> is gone.
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((l) => (l as HTMLLinkElement).href)
      .filter((href) => href.includes('family=Lobster:wght')),
  );
  expect(links).toHaveLength(1);

  // The path text re-renders in the now-available face.
  await expect.poll(async () => alphaDiff(await readLayer(page, layerId), fallback), { timeout: 5000 })
    .toBeGreaterThan(200);
  await page.screenshot({ path: 'e2e/screenshots/text-google-font-retry-loaded.png' });
});
