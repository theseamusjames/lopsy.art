import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  getEditorState,
  getPixelAt,
  drawRect,
  addLayer,
  setActiveLayer,
  docToScreen,
  selectTool,
  setForegroundColor,
  setToolOption,
} from './helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

async function pressMergeDown(page: Page): Promise<void> {
  await page.keyboard.press(`${mod}+KeyE`);
  await page.waitForTimeout(300);
}

async function clickAtDoc(page: Page, docX: number, docY: number): Promise<void> {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(80);
}

/**
 * Fill a rectangular marquee selection via Edit > Fill, entirely through
 * the UI (GPU-only paint, no JS-side pixel-cache sync). Unlike the
 * `drawRect` helper, this does NOT trigger a premature `cropLayerToContent`
 * — the layer stays full document size while active, matching how a real
 * user paints a fill (see e2e/GUIDE.md and mask-crop-offset-850.spec.ts's
 * `rectFill`). Using `drawRect` here would leave the layer (and the mask
 * added on top of it) cropped to the fill's own bounds even though the
 * layer was never switched away from, which isn't the scenario #851 is
 * about.
 */
async function rectFillViaMenu(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: { r: number; g: number; b: number },
): Promise<void> {
  await setForegroundColor(page, color.r, color.g, color.b);
  await selectTool(page, 'marquee-rect');
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

/** Two vertical brush strokes on the currently-edited mask, painting black
 * (hidden). Matches mask-crop-offset-850.spec.ts's proven approach — real
 * pointer input, not a direct store write. */
async function verticalMaskStroke(page: Page, x: number, y0: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x, y0);
  const b = await docToScreen(page, x, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

interface LayerSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  text?: string;
}

async function getLayers(page: Page): Promise<LayerSnapshot[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: LayerSnapshot[] } };
    };
    return store.getState().document.layers;
  });
}

test.describe('Merge Down — mask (#851)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  });

  test('merge down composites the upper layer through its mask instead of discarding it', async ({ page }) => {
    // Transparent: a non-transparent doc seeds an extra "Layer 1" above the
    // background (see create-document.ts), which would sit between the
    // background and our own new layer and break the "layer below" merge
    // target below.
    await createDocument(page, 400, 300, true);

    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Layer A: a visible green background.
    await setActiveLayer(page, bgId);
    await drawRect(page, 0, 0, 400, 300, { r: 0, g: 180, b: 0 });

    // Layer B above it: a 160x160 red square at (200, 100). Filled via the
    // menu (not `drawRect`) so the layer stays full document size while
    // active — see rectFillViaMenu's doc comment.
    const topId = await addLayer(page);
    await rectFillViaMenu(page, 200, 100, 360, 260, { r: 255, g: 0, b: 0 });

    // Add a mask to B and paint two vertical brush strokes to hide the
    // left half (x: 200-280) of the square in the mask, then leave
    // mask-edit mode — same UI-driven approach as
    // mask-crop-offset-850.spec.ts, per e2e/GUIDE.md's "test the UI"
    // mandate.
    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 90);
    await verticalMaskStroke(page, 220, 105, 255);
    await verticalMaskStroke(page, 260, 105, 255);
    await page.locator(`[data-layer-id="${topId}"]`).click();
    await page.waitForTimeout(150);

    // Merge B down onto A.
    await pressMergeDown(page);

    const after = await getEditorState(page);
    // Background + the root group layer.
    expect(after.document.layers).toHaveLength(2);
    expect(after.document.activeLayerId).toBe(bgId);

    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/merge-down-mask-after.png' });

    // Left half of the square was masked out on B — the merged result at
    // that doc position must still show A's green, not B's red.
    const left = await getPixelAt(page, 220, 150, bgId);
    expect(left.r).toBe(0);
    expect(left.g).toBe(180);
    expect(left.b).toBe(0);

    // Right half of the square was visible through the mask — the merged
    // result there must show B's red.
    const right = await getPixelAt(page, 320, 150, bgId);
    expect(right.r).toBe(255);
    expect(right.g).toBe(0);
    expect(right.b).toBe(0);
  });
});

test.describe('Merge Down — text layers (#859)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  });

  test('merge down onto a text layer converts the result to raster', async ({ page }) => {
    await createDocument(page, 800, 400, true);

    // Text layer "TOP" at (40, 30), size 80.
    await page.keyboard.press('t');
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setTextSetting: (key: 'fontSize', value: number) => void };
      };
      store.getState().setTextSetting('fontSize', 80);
    });
    await clickAtDoc(page, 40, 30);
    await page.keyboard.type('TOP', { delay: 30 });
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    let layers = await getLayers(page);
    const topTextLayer = layers.find((l) => l.type === 'text' && l.text === 'TOP');
    expect(topTextLayer).toBeDefined();
    const topId = topTextLayer!.id;

    // Text layer "BOTTOM" at (400, 250), above TOP in the layer stack.
    await page.keyboard.press('t');
    await page.waitForTimeout(100);
    await clickAtDoc(page, 400, 250);
    await page.keyboard.type('BOTTOM', { delay: 30 });
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    layers = await getLayers(page);
    const bottomTextLayer = layers.find((l) => l.type === 'text' && l.text === 'BOTTOM');
    expect(bottomTextLayer).toBeDefined();
    const bottomId = bottomTextLayer!.id;

    const s0 = await getEditorState(page);
    expect(s0.document.activeLayerId).toBe(bottomId);
    expect(s0.document.layerOrder.indexOf(bottomId)).toBeGreaterThan(
      s0.document.layerOrder.indexOf(topId),
    );

    await setActiveLayer(page, bottomId);
    await page.waitForTimeout(100);

    // Merge BOTTOM down onto TOP.
    await pressMergeDown(page);

    const after = await getEditorState(page);
    expect(after.document.activeLayerId).toBe(topId);
    expect(after.document.layers.find((l) => l.id === bottomId)).toBeUndefined();

    layers = await getLayers(page);
    const merged = layers.find((l) => l.id === topId);
    expect(merged).toBeDefined();

    // #859: the merged layer must not stay `type: 'text'` with stale text
    // properties from whichever layer survives — it now holds a raster
    // composite of both layers' pixels.
    expect(merged!.type).toBe('raster');
    expect(merged!.text).toBeUndefined();

    // The merged pixel content itself must be preserved (both strings'
    // rasterized glyphs), not reset to an empty doc-sized texture.
    const pixelData = await page.evaluate(async (id) => {
      const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        layerId?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await read(id);
      if (!result) return 0;
      let opaque = 0;
      for (let i = 3; i < result.pixels.length; i += 4) {
        if ((result.pixels[i] ?? 0) > 10) opaque++;
      }
      return opaque;
    }, topId);
    expect(pixelData).toBeGreaterThan(0);

    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/merge-down-text-after.png' });
  });
});
