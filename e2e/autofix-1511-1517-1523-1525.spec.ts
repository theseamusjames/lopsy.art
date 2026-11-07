import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  setForegroundColor,
  setToolOption,
  setBlendMode,
  configureEffect,
  setEffectColor,
  closeEffectsPanel,
  openEffectsPanel,
} from './helpers';

/**
 * #1511 — an Option/Alt+drag duplicate with the Move tool recorded two
 *         "Duplicate Layer" rows, so one undo/redo step did nothing.
 * #1517 — the Align buttons moved only the active layer when several were
 *         selected in the Layers panel.
 * #1523 — path text at 170 px and up came out softer on its first render
 *         than on any later one, so a Rotate 90° round-trip changed it.
 * #1525 — a Multiply layer's anti-aliased edge darkened into its own hard
 *         Drop Shadow, and Rasterize Layer Style changed that edge.
 */

interface Composite { width: number; height: number; pixels: number[] }

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(250);
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 10): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
}

async function fillMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  await dragDoc(page, x0, y0, x1, y1);
  await menu(page, 'Edit', /^Fill(\s*⇧F5)?$/);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

async function undoLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: { label: string }[] };
    };
    return store.getState().undoStack.map((e) => e.label);
  });
}

interface LayerInfo { id: string; name: string; type: string; x: number; y: number }

async function layers(page: Page): Promise<LayerInfo[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: LayerInfo[] } };
    };
    return store.getState().document.layers.map((l) => ({ id: l.id, name: l.name, type: l.type, x: l.x, y: l.y }));
  });
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

/** Document-space bounds of a layer's opaque pixels, read from its GPU texture. */
async function contentBounds(page: Page, layerId: string): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const store = w.__editorStore as { getState: () => { document: { layers: { id: string; x: number; y: number }[] } } };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const { width, height, pixels } = await read(id);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) < 128) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (left === Infinity) return null;
    return { left: layer.x + left, top: layer.y + top, right: layer.x + right + 1, bottom: layer.y + bottom + 1 };
  }, layerId);
}

interface Bounds { left: number; top: number; right: number; bottom: number }

// Firefox truncates clientX/Y to whole pixels, so a marquee drawn between
// doc coordinates at fit zoom can land a pixel short; tests compare against
// the measured fill instead of the requested rectangle.
function shifted(b: Bounds, dx: number, dy: number): Bounds {
  return { left: b.left + dx, top: b.top + dy, right: b.right + dx, bottom: b.bottom + dy };
}

/** The composited canvas sampled at every document pixel (top-down, doc space). */
async function readComposite(page: Page): Promise<Composite> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<Composite>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const pixels: number[] = new Array(doc.width * doc.height * 4).fill(0);
    for (let y = 0; y < doc.height; y++) {
      const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
      for (let x = 0; x < doc.width; x++) {
        const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
        const src = ((p.height - 1 - sy) * p.width + sx) * 4;
        const dst = (y * doc.width + x) * 4;
        for (let c = 0; c < 4; c++) pixels[dst + c] = p.pixels[src + c] ?? 0;
      }
    }
    return { width: doc.width, height: doc.height, pixels };
  });
}

function compositeDiff(a: Composite, b: Composite, threshold: number): { max: number; over: number } {
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  let max = 0;
  let over = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((a.pixels[i + c] ?? 0) - (b.pixels[i + c] ?? 0)));
    max = Math.max(max, d);
    if (d > threshold) over++;
  }
  return { max, over };
}

test.describe('Autofix #1511, #1517, #1523, #1525', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and options bar');
  });

  test('#1511: an Option-drag duplicate is one "Duplicate Layer" row, undone and redone in one step', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await setForegroundColor(page, 200, 30, 30);
    await fillMarquee(page, 100, 100, 200, 200);
    const before = await undoLabels(page);
    expect(before[before.length - 1]).toBe('Fill');
    const layerCount = (await layers(page)).length;
    const original = (await contentBounds(page, await activeLayerId(page)))!;
    expect(original).not.toBeNull();

    await page.keyboard.press('v');
    await page.keyboard.down('Alt');
    await dragDoc(page, 150, 150, 300, 150);
    await page.keyboard.up('Alt');
    await page.screenshot({ path: 'e2e/screenshots/alt-drag-duplicate-1511.png' });

    const after = await undoLabels(page);
    expect(after.slice(before.length)).toEqual(['Duplicate Layer']);
    expect((await layers(page)).length).toBe(layerCount + 1);
    const copy = (await layers(page)).find((l) => l.name === 'Layer 1 copy');
    expect(copy).toBeDefined();
    const moved = (await contentBounds(page, copy!.id))!;
    expect(moved).not.toBeNull();
    const dx = moved.left - original.left;
    expect(Math.abs(dx - 150)).toBeLessThanOrEqual(1);
    expect(moved).toEqual(shifted(original, dx, 0));

    // One undo removes the copy and lands on Fill.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    expect((await layers(page)).length).toBe(layerCount);
    expect(await undoLabels(page)).toEqual(before);

    // One redo brings the moved copy back.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(250);
    expect((await layers(page)).length).toBe(layerCount + 1);
    const redone = (await layers(page)).find((l) => l.name === 'Layer 1 copy')!;
    expect(await contentBounds(page, redone.id)).toEqual(moved);
  });

  test('#1517: Align left lines up every selected layer with the leftmost one', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await setForegroundColor(page, 30, 90, 200);
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(100);
    const boxA = await activeLayerId(page);
    await fillMarquee(page, 300, 100, 400, 200);
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(100);
    const boxB = await activeLayerId(page);
    await fillMarquee(page, 500, 350, 600, 450);
    const a0 = (await contentBounds(page, boxA))!;
    const b0 = (await contentBounds(page, boxB))!;
    expect(a0).not.toBeNull();
    expect(b0).not.toBeNull();
    expect(b0.left - a0.left).toBeGreaterThan(150);
    expect(b0.top - a0.top).toBeGreaterThan(150);

    await page.locator(`[data-layer-id="${boxA}"]`).click();
    await page.locator(`[data-layer-id="${boxB}"]`).click({ modifiers: ['Shift'] });
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    const labelsBefore = await undoLabels(page);

    await page.locator('button[aria-label="Align left"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/align-left-multi-1517.png' });

    const leftDx = a0.left - b0.left;
    expect(await contentBounds(page, boxA)).toEqual(a0);
    expect(await contentBounds(page, boxB)).toEqual(shifted(b0, leftDx, 0));
    expect((await undoLabels(page)).slice(labelsBefore.length)).toEqual(['Align Layer']);

    await page.locator('button[aria-label="Align bottom"]').click();
    await page.waitForTimeout(300);
    expect(await contentBounds(page, boxA)).toEqual(shifted(a0, 0, b0.bottom - a0.bottom));
    expect(await contentBounds(page, boxB)).toEqual(shifted(b0, leftDx, 0));

    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await contentBounds(page, boxA)).toEqual(a0);
    expect(await contentBounds(page, boxB)).toEqual(b0);
  });

  test('#1523: large path text renders the same before and after a Rotate 90° round-trip', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1500, 1200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    await setForegroundColor(page, 38, 16, 31);
    await page.keyboard.press('Control+a');
    await menu(page, 'Edit', /^Fill(\s*⇧F5)?$/);
    await page.keyboard.press('Control+d');

    // An arch over the top half of the page.
    await page.keyboard.press('p');
    await dragDoc(page, 265, 580, 325, 380, 6);
    await dragDoc(page, 1235, 580, 1295, 780, 6);
    await page.locator('[aria-label="Commit path"]').click();
    await page.waitForTimeout(200);
    const pathId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: { id: string }[] };
      };
      return store.getState().paths[0]!.id;
    });

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 200);
    await setForegroundColor(page, 255, 194, 61);
    await clickDoc(page, 300, 1000);
    await page.keyboard.type('XIPHIAS');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.locator('[aria-label="Text path"]').selectOption(pathId);
    await expect.poll(async () => (await layers(page)).some((l) => l.type === 'text' && l.y < 700), { timeout: 15000 }).toBe(true);
    await page.waitForTimeout(500);
    await page.keyboard.press('v');
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(300);

    const before = await readComposite(page);
    await page.screenshot({ path: 'e2e/screenshots/path-text-200px-before-1523.png' });

    await menu(page, 'Image', /^Rotate 90° CW/);
    await page.waitForTimeout(400);
    await menu(page, 'Image', /^Rotate 90° CCW/);
    await page.waitForTimeout(600);
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(300);
    const after = await readComposite(page);
    await page.screenshot({ path: 'e2e/screenshots/path-text-200px-after-1523.png' });

    // Golden glyphs are on the canvas…
    let golden = 0;
    for (let i = 0; i < before.pixels.length; i += 4) {
      if ((before.pixels[i] ?? 0) > 200 && (before.pixels[i + 2] ?? 0) < 120) golden++;
    }
    expect(golden).toBeGreaterThan(5000);
    // …and the round-trip re-render matches the first one.
    const diff = compositeDiff(before, after, 2);
    expect(diff.over).toBe(0);
  });

  test('#1525: a Multiply layer bakes its edge against its own hard Drop Shadow unchanged', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    const background = (await layers(page)).find((l) => l.name === 'Background')!;
    await page.locator(`[data-layer-id="${background.id}"]`).click();
    await setForegroundColor(page, 241, 234, 220);
    await page.keyboard.press('Control+a');
    await menu(page, 'Edit', /^Fill(\s*⇧F5)?$/);
    await page.keyboard.press('Control+d');

    const layer1 = (await layers(page)).find((l) => l.name === 'Layer 1')!;
    await page.locator(`[data-layer-id="${layer1.id}"]`).click();
    await setForegroundColor(page, 35, 150, 140);
    // An elliptical selection gives the slab an anti-aliased rim all round.
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await dragDoc(page, 200, 220, 600, 380);
    await menu(page, 'Edit', /^Fill(\s*⇧F5)?$/);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);

    await setBlendMode(page, 'multiply');
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': 10, 'Offset Y': 10, 'Blur': 0, 'Spread': 0, 'Opacity': 100,
    });
    await setEffectColor(page, 'Shadow color', 27, 26, 31);
    await page.waitForTimeout(300);
    await closeEffectsPanel(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(300);

    const live = await readComposite(page);
    await page.screenshot({ path: 'e2e/screenshots/multiply-shadow-live-1525.png' });

    // No pixel of the live canvas is darker than the shadow colour itself:
    // the slab's rim covers the shadow by its coverage, it doesn't multiply
    // into it.
    let darkest = 255;
    for (let i = 0; i < live.pixels.length; i += 4) {
      if ((live.pixels[i + 3] ?? 0) < 250) continue;
      darkest = Math.min(darkest, live.pixels[i + 1] ?? 255);
    }
    expect(darkest).toBeGreaterThanOrEqual(26 - 4);

    await openEffectsPanel(page);
    await page.getByTestId('effects-drawer').getByRole('button', { name: 'Rasterize Layer Style' }).click();
    await page.waitForTimeout(600);
    await closeEffectsPanel(page);
    await page.waitForTimeout(300);
    const baked = await readComposite(page);
    await page.screenshot({ path: 'e2e/screenshots/multiply-shadow-baked-1525.png' });

    // The baked layer is still Multiply, so the shadow itself multiplies
    // with the backdrop: 27,26,31 becomes 25,23,26 over the cream page.
    // Nothing changes by more than that — the rim used to change by up to 123.
    const diff = compositeDiff(live, baked, 6);
    expect(diff.over).toBe(0);
  });
});
