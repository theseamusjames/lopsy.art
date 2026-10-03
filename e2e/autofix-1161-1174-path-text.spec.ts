import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, setToolOption, waitForStore } from './helpers';

// #1161: text on a path ignored Align — glyphs always started at the path's
// first anchor. #1174: path text's texture (and so its Text-tool hit box) was
// padded by a font size on every side, so a click well below the glyphs
// re-opened the path text instead of starting a new layer.

interface TextInfo { id: string; text: string; x: number; y: number; pathId?: string }

interface Ink { left: number; right: number; top: number; bottom: number; texW: number; texH: number }

async function textLayers(page: Page): Promise<TextInfo[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<TextInfo & { type: string }> } };
    };
    return store.getState().document.layers
      .filter((l) => l.type === 'text')
      .map((l) => ({ id: l.id, text: l.text, x: l.x, y: l.y, pathId: l.pathId }));
  });
}

/** Document-space ink extent of a layer, read from its GPU texture. */
async function inkExtent(page: Page, layerId: string): Promise<Ink | null> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const { width, height, pixels } = await read(id);
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3]! <= 40) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (left === Infinity) return null;
    return {
      left: layer.x + left,
      right: layer.x + right + 1,
      top: layer.y + top,
      bottom: layer.y + bottom + 1,
      texW: width,
      texH: height,
    };
  }, layerId);
}

async function dragDoc(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
}

async function firstPathId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ id: string }> };
    };
    return store.getState().paths[0]!.id;
  });
}

async function commitPath(page: Page): Promise<string> {
  await page.locator('[aria-label="Commit path"]').click();
  await page.waitForTimeout(200);
  return firstPathId(page);
}

async function typeText(page: Page, at: [number, number], text: string): Promise<void> {
  await clickDoc(page, at[0], at[1]);
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
}

/** Bind the active text layer to `pathId` and wait until it reflows onto it. */
async function bindToPath(page: Page, pathId: string): Promise<TextInfo> {
  const before = (await textLayers(page))[0]!;
  await page.locator('[aria-label="Text path"]').selectOption(pathId);
  await expect
    .poll(async () => {
      const l = (await textLayers(page))[0]!;
      return l.pathId === pathId && (l.x !== before.x || l.y !== before.y);
    }, { timeout: 15000 })
    .toBe(true);
  await page.waitForTimeout(400);
  return (await textLayers(page))[0]!;
}

async function pickAlign(page: Page, align: 'left' | 'center' | 'right'): Promise<void> {
  await page.locator('select[aria-labelledby="text-align-label"]').selectOption(align);
  await page.waitForTimeout(400);
}

test.describe('#1161 — text on a path honours Align', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options bar requires desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 2400, 800, true);
    await page.waitForTimeout(300);
  });

  test('center and right alignment place the run in the middle / at the end of the path', async ({ page }) => {
    // A straight path from x=300 to x=1500 at y=300.
    await page.keyboard.press('p');
    await clickDoc(page, 300, 300);
    await clickDoc(page, 1500, 300);
    const pathId = await commitPath(page);

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 80);
    await pickAlign(page, 'center');
    await typeText(page, [300, 650], 'HELLO');
    const layer = await bindToPath(page, pathId);

    const centred = (await inkExtent(page, layer.id))!;
    await page.screenshot({ path: 'e2e/screenshots/path-text-align-center.png' });
    // The run's middle sits at the path's midpoint (x=900), not at its start.
    const mid = (centred.left + centred.right) / 2;
    expect(Math.abs(mid - 900)).toBeLessThan(12);
    const runWidth = centred.right - centred.left;
    expect(runWidth).toBeGreaterThan(150);
    expect(runWidth).toBeLessThan(400);

    await pickAlign(page, 'right');
    const right = (await inkExtent(page, layer.id))!;
    await page.screenshot({ path: 'e2e/screenshots/path-text-align-right.png' });
    // The last glyph ends at the path's last anchor (x=1500); only the O's
    // side bearing separates the ink from it.
    expect(right.right).toBeLessThanOrEqual(1500);
    expect(right.right).toBeGreaterThan(1500 - 15);

    await pickAlign(page, 'left');
    const left = (await inkExtent(page, layer.id))!;
    await page.screenshot({ path: 'e2e/screenshots/path-text-align-left.png' });
    expect(left.left).toBeGreaterThanOrEqual(300);
    expect(left.left).toBeLessThan(300 + 15);
    // The run keeps its width whichever way it is aligned.
    expect(Math.abs((right.right - right.left) - runWidth)).toBeLessThan(3);
    expect(Math.abs((left.right - left.left) - runWidth)).toBeLessThan(3);
  });
});

test.describe('#1174 — clicks just off path text start a new layer', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options bar requires desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);
    await page.waitForTimeout(300);
  });

  test('a click 45 px below path text creates a new text layer', async ({ page }) => {
    // A gentle arch from (200,450) to (600,450).
    await page.keyboard.press('p');
    await dragDoc(page, [200, 450], [260, 420]);
    await dragDoc(page, [600, 450], [660, 480]);
    const pathId = await commitPath(page);

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 50);
    await typeText(page, [100, 100], 'NO SMILES');
    const bound = await bindToPath(page, pathId);
    const ink = (await inkExtent(page, bound.id))!;
    await page.screenshot({ path: 'e2e/screenshots/path-text-hit-box-bound.png' });
    // The glyphs sit on the arch, ending at its baseline around y=450.
    expect(ink.bottom).toBeGreaterThan(430);
    expect(ink.bottom).toBeLessThan(465);
    // The texture — and with it the hover outline — hugs the ink.
    expect(ink.texH - (ink.bottom - ink.top)).toBeLessThanOrEqual(8);
    expect(ink.texW - (ink.right - ink.left)).toBeLessThanOrEqual(8);

    await typeText(page, [330, ink.bottom + 45], '$150');
    await page.screenshot({ path: 'e2e/screenshots/path-text-hit-box-new-layer.png' });
    const layers = await textLayers(page);
    expect(layers.map((l) => l.text).sort()).toEqual(['$150', 'NO SMILES']);
    expect(layers.find((l) => l.text === 'NO SMILES')!.pathId).toBe(pathId);
    expect(layers.find((l) => l.text === '$150')!.pathId).toBeUndefined();
  });

  test('a click on the glyphs still edits the path text', async ({ page }) => {
    await page.keyboard.press('p');
    await dragDoc(page, [200, 450], [260, 420]);
    await dragDoc(page, [600, 450], [660, 480]);
    const pathId = await commitPath(page);

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 50);
    await typeText(page, [100, 100], 'NO SMILES');
    const bound = await bindToPath(page, pathId);
    const ink = (await inkExtent(page, bound.id))!;

    // Click inside the first glyph's ink, near the bottom-left of the run.
    await clickDoc(page, ink.left + 12, ink.bottom - 15);
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const layers = await textLayers(page);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.text).toBe('NO SMILES!');
    expect(layers[0]!.pathId).toBe(pathId);
  });

  test('a click inside a tall arch, away from every glyph, starts a new layer', async ({ page }) => {
    // A tall arch: its ink box covers the space under the apex, but no glyph
    // is there.
    await page.keyboard.press('p');
    await dragDoc(page, [150, 500], [150, 300]);
    await dragDoc(page, [650, 500], [650, 700]);
    const pathId = await commitPath(page);

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 40);
    await typeText(page, [50, 60], 'OVER THE HILL AND FAR AWAY');
    const bound = await bindToPath(page, pathId);
    const ink = (await inkExtent(page, bound.id))!;
    await page.screenshot({ path: 'e2e/screenshots/path-text-hit-box-arch.png' });
    // The run climbs the arch from one foot to the other.
    expect(ink.left).toBeLessThan(200);
    expect(ink.right).toBeGreaterThan(560);
    expect(ink.top).toBeLessThan(380);
    expect(ink.bottom).toBeGreaterThan(470);

    // Under the apex, inside the ink box but ≥ 70 px from any glyph.
    await typeText(page, [400, 470], 'INSIDE');
    const layers = await textLayers(page);
    expect(layers.map((l) => l.text).sort()).toEqual(['INSIDE', 'OVER THE HILL AND FAR AWAY']);
  });
});
