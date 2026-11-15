import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, setToolOption, undo, redo } from './helpers';
import { clickAtDoc, getTextEditing } from './text-edit-helpers';

/**
 * #813: undoing a text edit must revert the rendered glyphs, not just the
 * layer's `text` property. During editing the live preview renders every
 * keystroke straight into the layer's GPU texture, so the history entry for
 * the commit has to carry the texture from *before* editing began.
 */

interface LayerTexture {
  text: string;
  width: number;
  height: number;
  opaque: number;
}

async function getTextLayerTexture(page: Page): Promise<LayerTexture> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; text?: string }> } };
    };
    const read = w.__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const layer = store.getState().document.layers.find((l) => l.type === 'text');
    if (!layer) return { text: '<none>', width: 0, height: 0, opaque: 0 };
    const px = await read(layer.id);
    let opaque = 0;
    for (let i = 3; i < px.pixels.length; i += 4) {
      if (px.pixels[i]! > 128) opaque++;
    }
    return { text: layer.text ?? '', width: px.width, height: px.height, opaque };
  });
}

/** Dark (text-coloured) pixels in a doc-space rect of the composited canvas. */
async function countDarkComposited(
  page: Page,
  rect: { x: number; y: number; w: number; h: number },
): Promise<number> {
  return page.evaluate(async (r) => {
    const w = window as unknown as Record<string, unknown>;
    const readComposite = w.__readCompositedPixels as () => Promise<{
      width: number; height: number; pixels: number[];
    }>;
    const store = w.__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const { document: doc, viewport } = store.getState();
    const snap = await readComposite();
    const dpr = snap.width / (document.querySelector('[data-testid="canvas-container"]') as HTMLElement)
      .getBoundingClientRect().width;
    const toScreen = (dx: number, dy: number) => ({
      x: Math.round(((dx - doc.width / 2) * viewport.zoom + viewport.panX) * dpr + snap.width / 2),
      y: Math.round(((dy - doc.height / 2) * viewport.zoom + viewport.panY) * dpr + snap.height / 2),
    });
    let dark = 0;
    for (let dy = r.y; dy < r.y + r.h; dy += 2) {
      for (let dx = r.x; dx < r.x + r.w; dx += 2) {
        const s = toScreen(dx, dy);
        const row = snap.height - 1 - s.y;
        const i = (row * snap.width + s.x) * 4;
        const lum = (snap.pixels[i]! + snap.pixels[i + 1]! + snap.pixels[i + 2]!) / 3;
        if (lum < 100) dark++;
      }
    }
    return dark;
  }, rect);
}

async function startDocWithTextTool(page: Page): Promise<void> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, false);
  await page.waitForTimeout(300);
  await page.keyboard.press('t');
  await setToolOption(page, 'Size', 50);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

// The committed HELLO sits to the right of the (40, 60) click; WORLD extends it.
const HELLO_RECT = { x: 40, y: 50, w: 200, h: 80 };
const WORLD_RECT = { x: 260, y: 50, w: 300, h: 80 };

test.describe('text undo reverts glyphs (#813)', () => {
  test('undo of a new text commit clears the glyphs; redo brings them back', async ({ page }) => {
    await startDocWithTextTool(page);
    await clickAtDoc(page, 40, 60);
    await page.keyboard.type('HELLO');
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(250);

    expect(await historyLabels(page)).toEqual(expect.arrayContaining(['Add Text Layer', 'Text']));
    const committed = await getTextLayerTexture(page);
    expect(committed.text).toBe('HELLO');
    expect(committed.opaque).toBeGreaterThan(200);
    expect(await countDarkComposited(page, HELLO_RECT)).toBeGreaterThan(50);

    await page.keyboard.press('v');
    await undo(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'e2e/screenshots/text-undo-glyphs-new-undone.png' });

    const undone = await getTextLayerTexture(page);
    expect(undone.text).toBe('');
    // The texture must no longer carry HELLO — the canvas region is blank.
    expect(undone.opaque).toBe(0);
    expect(await countDarkComposited(page, HELLO_RECT)).toBe(0);

    await redo(page);
    await page.waitForTimeout(250);
    const redone = await getTextLayerTexture(page);
    expect(redone.text).toBe('HELLO');
    expect(redone.opaque).toBe(committed.opaque);
    expect(await countDarkComposited(page, HELLO_RECT)).toBeGreaterThan(50);
  });

  test('undo of a re-edit restores the previous glyphs and texture size', async ({ page }) => {
    await startDocWithTextTool(page);
    await clickAtDoc(page, 40, 60);
    await page.keyboard.type('HELLO');
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(250);
    const hello = await getTextLayerTexture(page);
    expect(hello.text).toBe('HELLO');

    // Re-enter editing by clicking inside the committed text, append WORLD.
    await clickAtDoc(page, 80, 80);
    expect(await getTextEditing(page)).not.toBeNull();
    await page.keyboard.press('End');
    await page.keyboard.type(' WORLD');
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(250);

    const helloWorld = await getTextLayerTexture(page);
    expect(helloWorld.text).toBe('HELLO WORLD');
    expect(helloWorld.width).toBeGreaterThan(hello.width + 100);
    expect(await countDarkComposited(page, WORLD_RECT)).toBeGreaterThan(50);

    await page.keyboard.press('v');
    await undo(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'e2e/screenshots/text-undo-glyphs-reedit-undone.png' });

    const undone = await getTextLayerTexture(page);
    expect(undone.text).toBe('HELLO');
    expect(undone.width).toBe(hello.width);
    expect(undone.opaque).toBe(hello.opaque);
    // WORLD's glyphs are gone from the canvas; HELLO's remain.
    expect(await countDarkComposited(page, WORLD_RECT)).toBe(0);
    expect(await countDarkComposited(page, HELLO_RECT)).toBeGreaterThan(50);

    await redo(page);
    await page.waitForTimeout(250);
    const redone = await getTextLayerTexture(page);
    expect(redone.text).toBe('HELLO WORLD');
    expect(redone.width).toBe(helloWorld.width);
    expect(await countDarkComposited(page, WORLD_RECT)).toBeGreaterThan(50);
  });

  test('Escape while re-editing restores the committed glyphs', async ({ page }) => {
    await startDocWithTextTool(page);
    await clickAtDoc(page, 40, 60);
    await page.keyboard.type('HELLO');
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(250);
    const hello = await getTextLayerTexture(page);

    await clickAtDoc(page, 80, 80);
    await page.keyboard.press('End');
    await page.keyboard.type(' WORLD');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    const cancelled = await getTextLayerTexture(page);
    expect(cancelled.text).toBe('HELLO');
    expect(cancelled.width).toBe(hello.width);
    expect(await countDarkComposited(page, WORLD_RECT)).toBe(0);
  });
});
