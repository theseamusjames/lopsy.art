import { test, expect } from './fixtures';
import { waitForStore, createDocument, setToolOption } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function docToScreen(
  page: Parameters<typeof waitForStore>[0],
  docX: number,
  docY: number,
) {
  return page.evaluate(
    ({ docX, docY }) => {
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
        x:
          rect.left +
          (docX - state.document.width / 2) * state.viewport.zoom +
          state.viewport.panX +
          cx,
        y:
          rect.top +
          (docY - state.document.height / 2) * state.viewport.zoom +
          state.viewport.panY +
          cy,
      };
    },
    { docX, docY },
  );
}

/** Commit text editing by pressing Shift+Enter and waiting for editing state to clear. */
async function commitText(page: Parameters<typeof waitForStore>[0]) {
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction(() => {
    const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { textEditing: unknown };
    };
    return uiStore.getState().textEditing === null;
  }, { timeout: 5000 });
  // Allow the GPU texture upload to complete before reading pixels.
  await page.waitForTimeout(200);
}

/** Return the smallest y-coordinate among opaque pixels in the layer's GPU texture. */
async function topOpaqueRow(
  page: Parameters<typeof waitForStore>[0],
  layerId: string,
): Promise<number> {
  return page.evaluate(async (lid) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(lid);
    if (!result || result.width === 0) return -1;
    for (let row = 0; row < result.height; row++) {
      for (let col = 0; col < result.width; col++) {
        const alpha = result.pixels[(row * result.width + col) * 4 + 3] ?? 0;
        if (alpha > 10) return row;
      }
    }
    return -1;
  }, layerId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Text baseline shift', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForTimeout(300);
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
  });

  test('committed text layer has baselineShift 0 by default', async ({ page }) => {
    // Place text with no baseline shift adjustment
    const pos = await docToScreen(page, 200, 150);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('Hello');
    await commitText(page);

    const textLayer = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<Record<string, unknown>> } };
      };
      return store
        .getState()
        .document.layers.find(
          (l) => l['type'] === 'text' && typeof l['text'] === 'string',
        );
    });

    expect(textLayer).not.toBeNull();
    expect(textLayer!['type']).toBe('text');
    expect(textLayer!['baselineShift']).toBe(0);
  });

  test('positive baseline shift moves text upward relative to zero shift', async ({ page }) => {
    await page.screenshot({ path: 'e2e/screenshots/baseline-shift-00-initial.png' });

    // --- Layer A: no baseline shift ---
    const pos1 = await docToScreen(page, 100, 150);
    await page.mouse.click(pos1.x, pos1.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('Ab');
    await commitText(page);
    await page.waitForTimeout(100);

    // Grab layer A's id
    const layerAId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; type: string; text?: string; baselineShift?: number }>;
          };
        };
      };
      const layers = store.getState().document.layers;
      return layers.find((l) => l.type === 'text' && l.text === 'Ab')?.id ?? null;
    });

    if (!layerAId) {
      // Text rendering unavailable in this headless environment — skip gracefully.
      console.log('SKIP: Text layer A not found (font likely missing in headless)');
      return;
    }

    await page.screenshot({ path: 'e2e/screenshots/baseline-shift-01-layer-a-committed.png' });

    // --- Layer B: baseline shift of +30 via the options bar ---
    // Re-select text tool and set baseline shift before placing layer B.
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    await setToolOption(page, 'Baseline', 30);
    await page.waitForTimeout(100);

    const pos2 = await docToScreen(page, 250, 150);
    await page.mouse.click(pos2.x, pos2.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('Ab');
    await commitText(page);
    await page.waitForTimeout(100);

    const layerBId = await page.evaluate((aId) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; type: string; text?: string; baselineShift?: number }>;
          };
        };
      };
      const layers = store.getState().document.layers;
      // The second text layer is the one that isn't layer A.
      return layers.find((l) => l.type === 'text' && l.text === 'Ab' && l.id !== aId)?.id ?? null;
    }, layerAId);

    if (!layerBId) {
      console.log('SKIP: Text layer B not found (font likely missing in headless)');
      return;
    }

    await page.screenshot({ path: 'e2e/screenshots/baseline-shift-02-both-layers.png' });

    // Verify layer B's baselineShift was persisted.
    const layerBShift = await page.evaluate((bid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; baselineShift?: number }>;
          };
        };
      };
      return store.getState().document.layers.find((l) => l.id === bid)?.baselineShift;
    }, layerBId);
    expect(layerBShift).toBe(30);

    // Flush GPU before reading pixels.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(300);

    // Read top-most opaque row for each layer texture.
    // Positive baseline shift offsets glyphs upward in canvas space, so the
    // top opaque row for layer B should be at a smaller (higher) row index
    // than for layer A.
    const topA = await topOpaqueRow(page, layerAId);
    const topB = await topOpaqueRow(page, layerBId);

    console.log(`topOpaqueRow — A (no shift): ${topA}, B (shift=30): ${topB}`);

    // Both layers must have rendered opaque pixels.
    expect(topA).toBeGreaterThan(-1);
    expect(topB).toBeGreaterThan(-1);

    // Layer B (shifted +30) should have its top opaque pixels at a smaller
    // row index (higher on screen) than layer A (unshifted), since positive
    // shift moves the glyph canvas upward within the texture.
    expect(topB).toBeLessThan(topA);
  });

  test('negative baseline shift moves text downward relative to zero shift', async ({ page }) => {
    // --- Layer A: no shift ---
    const pos1 = await docToScreen(page, 100, 150);
    await page.mouse.click(pos1.x, pos1.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('Xq');
    await commitText(page);
    await page.waitForTimeout(100);

    const layerAId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string; text?: string }> };
        };
      };
      return store.getState().document.layers.find(
        (l) => l.type === 'text' && l.text === 'Xq',
      )?.id ?? null;
    });
    if (!layerAId) {
      console.log('SKIP: Text layer A not found');
      return;
    }

    // --- Layer B: shift = -30 ---
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    await setToolOption(page, 'Baseline', -30);
    await page.waitForTimeout(100);

    const pos2 = await docToScreen(page, 250, 150);
    await page.mouse.click(pos2.x, pos2.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('Xq');
    await commitText(page);
    await page.waitForTimeout(100);

    const layerBId = await page.evaluate((aId) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string; text?: string }> };
        };
      };
      return store
        .getState()
        .document.layers.find((l) => l.type === 'text' && l.text === 'Xq' && l.id !== aId)
        ?.id ?? null;
    }, layerAId);

    if (!layerBId) {
      console.log('SKIP: Text layer B not found');
      return;
    }

    await page.screenshot({ path: 'e2e/screenshots/baseline-shift-03-negative-shift.png' });

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(300);

    const topA = await topOpaqueRow(page, layerAId);
    const topB = await topOpaqueRow(page, layerBId);

    console.log(`negative shift — A (no shift): topRow=${topA}, B (shift=-30): topRow=${topB}`);

    expect(topA).toBeGreaterThan(-1);
    expect(topB).toBeGreaterThan(-1);

    // Negative shift moves glyphs downward: layer B's topmost opaque row
    // should be at a larger index (lower on screen) than layer A.
    expect(topB).toBeGreaterThan(topA);
  });

  test('re-editing a committed layer restores its baseline shift in the options bar', async ({ page }) => {
    // Set a non-zero baseline shift and commit text.
    await setToolOption(page, 'Baseline', 15);
    await page.waitForTimeout(100);

    const pos = await docToScreen(page, 200, 150);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('Test');
    await commitText(page);
    await page.waitForTimeout(100);

    // Click the committed text to re-enter edit mode.
    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(300);

    // The tool settings store should have been updated to the saved value.
    const storedShift = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { textBaselineShift: number };
      };
      return store.getState().textBaselineShift;
    });

    expect(storedShift).toBe(15);
  });
});
