/**
 * Regression: marquee right half, cut, paste, move to 0,0, merge down.
 */
import { test, expect, type Page } from './fixtures';

async function createDocument(page: Page, width: number, height: number) {
  await page.evaluate(({ w, h }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(w, h, false);
  }, { w: width, h: height });
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(({ docX, docY }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const container = document.querySelector('[data-testid="canvas-container"]');
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return {
      x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
      y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
    };
  }, { docX, docY });
}

async function setTool(page: Page, tool: string) {
  await page.evaluate((t) => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    ui.getState().setActiveTool(t);
  }, tool);
}

async function setSelection(page: Page, x: number, y: number, w: number, h: number) {
  await page.evaluate(({ x, y, w, h }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        setSelection: (
          bounds: { x: number; y: number; width: number; height: number },
          mask: Uint8ClampedArray, maskWidth: number, maskHeight: number,
        ) => void;
      };
    };
    const state = store.getState();
    const maskW = state.document.width;
    const maskH = state.document.height;
    const mask = new Uint8ClampedArray(maskW * maskH);
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px >= 0 && px < maskW && py >= 0 && py < maskH) {
          mask[py * maskW + px] = 255;
        }
      }
    }
    state.setSelection({ x, y, width: w, height: h }, mask, maskW, maskH);
  }, { x, y, w, h });
}

async function countLayerOpaquePixels(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (lid) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await fn(lid);
    if (!result || result.width === 0) return 0;
    let count = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      if ((result.pixels[i]! > 0)) count++;
    }
    return count;
  }, layerId);
}

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

test.describe('Text selection + merge', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  });

  test('marquee right half, cut, paste, move to 0,0, merge down', async ({ page }) => {
    // 1. New doc
    await createDocument(page, 800, 400);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    // 2. Add text 150px "LOPSY"
    await setTool(page, 'text');
    await page.evaluate(() => {
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setTextFontSize: (s: number) => void;
          setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
          setTextFontFamily: (f: string) => void;
        };
      };
      const s = ts.getState();
      s.setTextFontSize(150);
      s.setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
      s.setTextFontFamily('Inter');
    });
    const textPos = await docToScreen(page, 150, 100);
    await page.mouse.click(textPos.x, textPos.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('LOPSY');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(500);

    const textId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }> };
        };
      };
      return store.getState().document.layers.find((l) => l.type === 'text')?.id ?? '';
    });
    await page.evaluate((id: string) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      store.getState().setActiveLayer(id);
    }, textId);
    await page.waitForTimeout(100);

    await page.screenshot({ path: 'e2e/screenshots/text-sel-merge-initial.png' });

    // 3. Marquee around right half of document
    await setSelection(page, 400, 0, 400, 400);
    await page.waitForTimeout(200);

    // 4. Cut
    await page.keyboard.press(`${mod}+KeyX`);
    await page.waitForTimeout(300);

    // 5. Paste
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(300);

    // 6. Deselect
    await page.keyboard.press(`${mod}+KeyD`);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-sel-merge-after-paste.png' });

    // 7. Move pasted layer to 0,0 — use updateLayerPosition directly
    const pastedId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    await page.evaluate(({ id }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { updateLayerPosition: (id: string, x: number, y: number) => void };
      };
      store.getState().updateLayerPosition(id, 0, 0);
    }, { id: pastedId });
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-sel-merge-after-move.png' });

    // Count pixels before merge
    const textPixelsBefore = await countLayerOpaquePixels(page, textId);
    const pastedPixelsBefore = await countLayerOpaquePixels(page, pastedId);
    console.log(`Before merge: text=${textPixelsBefore}, pasted=${pastedPixelsBefore}`);

    // 8. Merge down
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/text-sel-merge-after-merge1.png' });

    const mergedId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    const mergedPixels = await countLayerOpaquePixels(page, mergedId);
    console.log(`After merge: merged=${mergedPixels}`);

    // Merged layer must have content from BOTH layers
    expect(mergedPixels).toBeGreaterThan(textPixelsBefore);
    expect(mergedPixels).toBeGreaterThan(pastedPixelsBefore);
  });
});
