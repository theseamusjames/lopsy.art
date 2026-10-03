/**
 * #1179 — Delete Path records a history entry, so ⌘Z brings the path back
 *         instead of undoing the edit before it.
 * #1169 — the Gradient tool lines up with the drag on a layer moved to a
 *         negative offset (the shader compared texture-local positions with
 *         document-space endpoints).
 * #1160 — Mesh Warp moves content by the dragged distance instead of
 *         snapping to steps of docSize / 127.
 */
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  docToScreen,
  getEditorState,
  getPixelAt,
  selectTool,
  setForegroundColor,
  waitForStore,
} from './helpers';

const SHOTS = 'e2e/screenshots';

async function dragDoc(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
}

async function activeLayerId(page: Page): Promise<string> {
  return (await getEditorState(page)).document.activeLayerId;
}

async function layerPos(page: Page, id: string): Promise<{ x: number; y: number }> {
  const layer = (await getEditorState(page)).document.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`layer ${id} missing`);
  return { x: layer.x, y: layer.y };
}

/** Marquee a doc-space rect and bucket-fill it with the foreground colour. */
async function fillRect(page: Page, x: number, y: number, w: number, h: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, { x, y }, { x: x + w, y: y + h }, 5);
  await selectTool(page, 'fill');
  await clickDoc(page, x + w / 2, y + h / 2);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// #1179 — Delete Path history
// ---------------------------------------------------------------------------

async function showPathsPanel(page: Page) {
  const list = page.locator('[role="listbox"][aria-label="Paths"]');
  if (!(await list.isVisible().catch(() => false))) {
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
  }
  await expect(list).toBeVisible();
  return list;
}

async function drawClosedPenPath(page: Page): Promise<void> {
  await selectTool(page, 'path');
  await clickDoc(page, 500, 100);
  await clickDoc(page, 700, 100);
  await clickDoc(page, 600, 250);
  await clickDoc(page, 500, 100);
  await page.waitForTimeout(150);
}

async function brushStroke(page: Page): Promise<void> {
  await selectTool(page, 'brush');
  await dragDoc(page, { x: 100, y: 400 }, { x: 300, y: 400 }, 12);
}

async function deleteSelectedPathViaPanel(page: Page): Promise<void> {
  const list = await showPathsPanel(page);
  const row = list.locator('[role="option"]').first();
  if ((await row.getAttribute('aria-selected')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await page.locator('button[aria-label="Delete Path"]').click();
  await expect(list.locator('[role="option"]')).toHaveCount(0);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label?: string }> };
    };
    return store.getState().undoStack.map((s) => s.label ?? '');
  });
}

test.describe('#1179 Delete Path is undoable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('brush, pen path, delete path, undo: the path comes back', async ({ page }) => {
    await brushStroke(page);
    await drawClosedPenPath(page);
    expect((await historyLabels(page)).at(-1)).toBe('Add Path');

    await deleteSelectedPathViaPanel(page);
    expect((await historyLabels(page)).at(-1)).toBe('Delete Path');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/delete-path-undo-restores-path.png` });

    const list = await showPathsPanel(page);
    await expect(list.locator('[role="option"]')).toHaveCount(1);
    await expect(list.locator('[role="option"]').first()).toContainText('Path');
  });

  test('pen path, brush, delete path, undo: the path returns and the stroke stays', async ({ page }) => {
    await drawClosedPenPath(page);
    const strokeLayer = await activeLayerId(page);
    await brushStroke(page);

    await deleteSelectedPathViaPanel(page);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/delete-path-undo-keeps-stroke.png` });

    const list = await showPathsPanel(page);
    await expect(list.locator('[role="option"]')).toHaveCount(1);

    // The brush stroke (default black, painted along y = 400 from x = 100 to
    // 300) is still on the layer; before the fix ⌘Z undid it instead.
    const onStroke = await getPixelAt(page, 200, 400, strokeLayer);
    expect(onStroke.a).toBeGreaterThan(200);
    expect(onStroke.r).toBeLessThan(60);
    const offStroke = await getPixelAt(page, 200, 300, strokeLayer);
    expect(offStroke.a).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #1169 — Gradient on an offset layer
// ---------------------------------------------------------------------------

/**
 * A white band at doc y 300..400 on Layer 1, moved 100 px with Shift+arrow
 * nudges, then loaded as a selection from the layer thumbnail.
 */
async function setUpNudgedBand(page: Page, key: 'ArrowUp' | 'ArrowDown'): Promise<string> {
  const id = await activeLayerId(page);
  await setForegroundColor(page, 255, 255, 255);
  await fillRect(page, 100, 300, 600, 100);

  await selectTool(page, 'move');
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press(`Shift+${key}`);
  }
  await page.waitForTimeout(200);

  await page.locator(`[data-layer-id="${id}"] [class*="thumbnail"]`).first()
    .click({ modifiers: ['Control'] });
  await page.waitForTimeout(200);
  return id;
}

async function gradientTool(page: Page, type: 'linear' | 'radial') {
  await page.locator('[data-tool-id="gradient"]').click();
  await page.locator('[aria-labelledby="gradient-type-label"]').selectOption(type);
}

test.describe('#1169 Gradient follows the drag on an offset layer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('linear gradient on a layer nudged up (negative offset)', async ({ page }) => {
    const id = await setUpNudgedBand(page, 'ArrowUp');
    expect((await layerPos(page, id)).y).toBeLessThan(0);

    await gradientTool(page, 'linear');
    await dragDoc(page, { x: 400, y: 200 }, { x: 400, y: 300 });
    await page.screenshot({ path: `${SHOTS}/gradient-negative-offset-linear.png` });

    // Default stops are black → white along the 100 px drag.
    const top = await getPixelAt(page, 400, 205, id);
    const mid = await getPixelAt(page, 400, 250, id);
    const bottom = await getPixelAt(page, 400, 295, id);
    expect(top.a).toBe(255);
    expect(top.r).toBeLessThan(40);
    expect(Math.abs(mid.r - 128)).toBeLessThan(20);
    expect(bottom.r).toBeGreaterThan(215);
    // Outside the band (and the selection) the layer stays empty.
    expect((await getPixelAt(page, 400, 150, id)).a).toBe(0);
  });

  test('radial gradient on a layer nudged up (negative offset)', async ({ page }) => {
    const id = await setUpNudgedBand(page, 'ArrowUp');
    await gradientTool(page, 'radial');
    await dragDoc(page, { x: 400, y: 250 }, { x: 480, y: 250 });
    await page.screenshot({ path: `${SHOTS}/gradient-negative-offset-radial.png` });

    // Black at the centre, half-way grey 40 px out, white past the radius.
    expect((await getPixelAt(page, 400, 250, id)).r).toBeLessThan(25);
    expect(Math.abs((await getPixelAt(page, 440, 250, id)).r - 128)).toBeLessThan(20);
    expect(Math.abs((await getPixelAt(page, 400, 290, id)).r - 128)).toBeLessThan(20);
    expect((await getPixelAt(page, 500, 250, id)).r).toBeGreaterThan(235);
  });

  test('linear gradient on a layer nudged down (positive offset)', async ({ page }) => {
    const id = await setUpNudgedBand(page, 'ArrowDown');

    await gradientTool(page, 'linear');
    await dragDoc(page, { x: 400, y: 400 }, { x: 400, y: 500 });
    await page.screenshot({ path: `${SHOTS}/gradient-positive-offset-linear.png` });

    const top = await getPixelAt(page, 400, 405, id);
    const mid = await getPixelAt(page, 400, 450, id);
    const bottom = await getPixelAt(page, 400, 495, id);
    expect(top.a).toBe(255);
    expect(top.r).toBeLessThan(40);
    expect(Math.abs(mid.r - 128)).toBeLessThan(20);
    expect(bottom.r).toBeGreaterThan(215);
    expect((await getPixelAt(page, 400, 350, id)).a).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #1160 — Mesh Warp precision
// ---------------------------------------------------------------------------

/** Opaque-pixel bounding box of a layer in document coordinates. */
async function opaqueBounds(page: Page, id: string) {
  return page.evaluate(async (lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(lid);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) < 128) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const ox = layer?.x ?? 0;
    const oy = layer?.y ?? 0;
    return { minX: minX + ox, maxX: maxX + ox, minY: minY + oy, maxY: maxY + oy };
  }, id);
}

test.describe('#1160 Mesh Warp moves content by the dragged distance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 2400, 800, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  for (const dragPx of [9, 10]) {
    test(`a ${dragPx} px drag of the centre point moves a small square ~${dragPx} px`, async ({ page }) => {
      const id = await activeLayerId(page);
      await fillRect(page, 1180, 380, 40, 40);
      await page.keyboard.press('Control+1');
      await page.waitForTimeout(200);
      const before = await opaqueBounds(page, id);
      expect(before.maxX - before.minX).toBeGreaterThan(35);

      await selectTool(page, 'move');
      await page.locator('button[aria-label="Activate mesh warp"]').click();
      await page.locator('select[aria-label="Grid size"]').selectOption('3');
      await dragDoc(page, { x: 1200, y: 400 }, { x: 1200 + dragPx, y: 400 }, 6);
      await page.locator('[role="group"][aria-label="Mesh warp controls"] button:has-text("Apply")').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/mesh-warp-precision-${dragPx}px.png` });

      const after = await opaqueBounds(page, id);
      const shift = (after.minX + after.maxX) / 2 - (before.minX + before.maxX) / 2;
      // Before the fix a 9 px drag quantised to 0 px and a 10 px drag to
      // 2400 / 127 ≈ 18.9 px.
      expect(Math.abs(shift - dragPx)).toBeLessThanOrEqual(1.5);
      expect(Math.abs((after.minY + after.maxY) / 2 - (before.minY + before.maxY) / 2)).toBeLessThanOrEqual(1);
    });
  }
});


/**
 * For each doc column in `columns`, the first and last doc row below
 * y = 400 whose alpha exceeds 127, or null when the column is empty there.
 */
async function bandRows(page: Page, id: string, columns: number[]) {
  return page.evaluate(async ({ lid, columns }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(lid);
    const ox = layer?.x ?? 0;
    const oy = layer?.y ?? 0;
    return columns.map((docX) => {
      let top = -1;
      let bottom = -1;
      for (let y = Math.max(0, 400 - oy); y < height; y++) {
        if ((pixels[(y * width + docX - ox) * 4 + 3] ?? 0) <= 127) continue;
        if (top < 0) top = y + oy;
        bottom = y + oy;
      }
      return top < 0 ? null : { top, bottom };
    });
  }, { lid: id, columns });
}

test.describe('#1160 Mesh Warp inverse under strong compression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 800, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('a band squashed to a tenth of its height lands where the mesh puts it', async ({ page }) => {
    const id = await activeLayerId(page);
    // A 24 px black band across doc y 576..600.
    await fillRect(page, 100, 576, 600, 24);

    await selectTool(page, 'move');
    await page.locator('button[aria-label="Activate mesh warp"]').click();
    await page.locator('select[aria-label="Grid size"]').selectOption('3');
    // Pull the centre point from y = 400 to 760: next to it the lower cells
    // shrink to a tenth of their height, squashing the band to ~2.4 px.
    await dragDoc(page, { x: 400, y: 400 }, { x: 400, y: 760 }, 12);
    await page.locator('[role="group"][aria-label="Mesh warp controls"] button:has-text("Apply")').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/mesh-warp-compressed-band.png` });

    // Only Y moves and the map is bilinear per cell, so every column is an
    // affine stretch of itself. Column 400 maps the lower half (400..800)
    // onto 760..800: the band (576..600) belongs at 777.6..780. Columns 200
    // and 600 sit half-way to the moved point: their centre row lands at
    // 580, the lower half maps onto 580..800 and the band onto 676.8..690.
    // The damped fixed-point inverse stopped short in the squashed cells and
    // drew the tip ~15 px too high.
    const [left, centre, right] = await bandRows(page, id, [200, 400, 600]);
    for (const col of [left, right]) {
      expect(col).not.toBeNull();
      expect(Math.abs(col!.top - 677)).toBeLessThanOrEqual(2);
      expect(Math.abs(col!.bottom - 689)).toBeLessThanOrEqual(2);
    }
    expect(centre).not.toBeNull();
    expect(centre!.top).toBeGreaterThanOrEqual(776);
    expect(centre!.bottom).toBeLessThanOrEqual(781);
  });
});
