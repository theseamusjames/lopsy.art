/**
 * Cut/paste positioning and clipboard integrity bugs.
 *
 * Bug 1: Pasting with an active marquee should paste in-place (at the
 *   original cut position), but content lands at 0,0 or another wrong
 *   position instead.
 *
 * Bug 2: After cutting text content and pasting, sometimes old clipboard
 *   data is pasted instead of the freshly cut pixels.
 */
import { test, expect, type Page } from './fixtures';
import {
  drawEllipse,
  drawRect,
  docToScreen,
  selectTool,
  setForegroundColor,
  addLayer,
  moveLayerTo,
  setActiveLayer,
  undo,
  redo,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width: number, height: number, transparent = false) {
  await page.evaluate(({ w, h, t }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(w, h, t);
  }, { w: width, h: height, t: transparent });
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
  await page.waitForSelector('[data-testid="canvas-container"]');
}

async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    const doc = state.document as {
      width: number;
      height: number;
      layers: Array<{
        id: string;
        name: string;
        type: string;
        visible: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
      layerOrder: string[];
      activeLayerId: string;
    };
    return {
      document: doc,
      clipboard: state.clipboard as {
        width: number;
        height: number;
        offsetX: number;
        offsetY: number;
      } | null,
      selection: state.selection as {
        active: boolean;
        bounds: { x: number; y: number; width: number; height: number } | null;
      },
    };
  });
}

async function waitForLayerCount(page: Page, count: number) {
  await page.waitForFunction(
    (expected) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      };
      return store.getState().document.layers.length === expected;
    },
    count,
    { timeout: 5000 },
  );
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

async function countOpaquePixelsInRegion(
  page: Page,
  layerId: string,
  region: { x: number; y: number; width: number; height: number },
): Promise<number> {
  return page.evaluate(async ({ lid, region }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    const lx = layer?.x ?? 0;
    const ly = layer?.y ?? 0;
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(lid);
    if (!result || result.width === 0) return 0;
    let count = 0;
    for (let dy = 0; dy < region.height; dy++) {
      for (let dx = 0; dx < region.width; dx++) {
        const docX = region.x + dx;
        const docY = region.y + dy;
        const localX = docX - lx;
        const localY = docY - ly;
        if (localX >= 0 && localX < result.width && localY >= 0 && localY < result.height) {
          const idx = (localY * result.width + localX) * 4;
          if ((result.pixels[idx + 3] ?? 0) > 10) count++;
        }
      }
    }
    return count;
  }, { lid: layerId, region });
}

async function countLayerOpaquePixels(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (lid) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(lid);
    if (!result || result.width === 0) return 0;
    let count = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      if ((result.pixels[i]! > 10)) count++;
    }
    return count;
  }, layerId);
}

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
});

// ===========================================================================
// Bug 1: Cut/paste positions content at original location, not 0,0
// ===========================================================================

test.describe('Cut/paste ellipse positioning', () => {
  test('paste places content at the original cut position, not at 0,0', async ({ page }) => {
    // 1. New transparent doc
    await createDocument(page, 600, 400, true);
    await page.waitForTimeout(300);

    // 2. Draw three ellipses on separate layers so they all survive.
    //    Each drawEllipse call draws on the active layer, so add a fresh
    //    layer before each draw to avoid overwriting.
    //    Ellipse A: left (cx=100, cy=200)
    //    Ellipse B: center (cx=300, cy=200)
    //    Ellipse C: right (cx=500, cy=200)
    await drawEllipse(page, 100, 200, 40, 30, { r: 255, g: 0, b: 0 });
    await addLayer(page);
    await drawEllipse(page, 300, 200, 40, 30, { r: 0, g: 255, b: 0 });
    await addLayer(page);
    await drawEllipse(page, 500, 200, 40, 30, { r: 0, g: 0, b: 255 });

    // Merge all layers down so cut captures content from all three shapes.
    // Ctrl+E merges active layer into the one below; repeat to flatten.
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(200);
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(200);
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-position-initial.png' });

    // Verify all three ellipses rendered — check composited pixels at each center
    const compositedSnap = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      return readFn();
    });

    // 3. Marquee around center and right ellipses (x=250..550, y=160..240)
    await setSelection(page, 250, 160, 300, 80);
    await page.waitForTimeout(200);

    // 4. Cut — removes center + right ellipses from the layer
    await page.keyboard.press(`${mod}+KeyX`);
    await page.waitForTimeout(300);

    // Verify clipboard offset matches the selection area, not 0,0
    const stateAfterCut = await getEditorState(page);
    expect(stateAfterCut.clipboard).not.toBeNull();
    expect(stateAfterCut.clipboard!.offsetX).toBeGreaterThanOrEqual(250);
    expect(stateAfterCut.clipboard!.offsetY).toBeGreaterThanOrEqual(160);

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-position-after-cut.png' });

    // 5. Paste (selection/marquee is still visible)
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-position-after-paste.png' });

    // 6. Verify: the pasted layer should be at the original cut position,
    //    NOT at 0,0 or near the top-left corner
    const stateAfterPaste = await getEditorState(page);
    const pastedLayer = stateAfterPaste.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();

    // The pasted layer should be positioned near the selection area (250+, 160+),
    // not at 0,0 or the top-left
    expect(pastedLayer!.x).toBeGreaterThanOrEqual(250);
    expect(pastedLayer!.y).toBeGreaterThanOrEqual(160);

    // Content should NOT be at 0,0 (the bug: center of pasted content at origin)
    expect(pastedLayer!.x).not.toBe(0);
    expect(pastedLayer!.y).not.toBe(0);

    // 7. Verify the pasted content has pixels in the expected region
    const pastedId = pastedLayer!.id;
    const pixelsInOriginalRegion = await countOpaquePixelsInRegion(page, pastedId, {
      x: 250, y: 160, width: 300, height: 80,
    });
    expect(pixelsInOriginalRegion).toBeGreaterThan(0);

    // 8. Verify no content leaked to the top-left corner (0,0 area)
    const pixelsAtOrigin = await countOpaquePixelsInRegion(page, pastedId, {
      x: 0, y: 0, width: 50, height: 50,
    });
    expect(pixelsAtOrigin).toBe(0);
  });

  test('paste without explicit position centers on artboard, not at 0,0', async ({ page }) => {
    await createDocument(page, 600, 400, true);
    await page.waitForTimeout(300);

    // Draw a single ellipse off-center
    await drawEllipse(page, 450, 300, 40, 30, { r: 255, g: 128, b: 0 });

    // Select and copy just the ellipse
    await setSelection(page, 410, 270, 80, 60);
    await page.keyboard.press(`${mod}+KeyC`);
    await page.waitForTimeout(200);

    // Clear selection so paste has no target region
    await page.keyboard.press(`${mod}+KeyD`);
    await page.waitForTimeout(200);

    // Paste — should land at original offset (410, 270), NOT at 0,0
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(500);

    const state = await getEditorState(page);
    const pastedLayer = state.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();

    // Should be near the original position, not at origin
    expect(pastedLayer!.x).toBeGreaterThan(100);
    expect(pastedLayer!.y).toBeGreaterThan(100);

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-position-no-selection.png' });
  });

  test('system-clipboard paste-back of an internal copy lands at the copied position, not 0,0', async ({ page }) => {
    // Reproduces the real-browser path that unit-headless tests miss: copy()
    // mirrors the selection to the system clipboard as a position-less PNG, so
    // a native Cmd+V paste event carries that image. The handler must recognise
    // it as our own copy (by matching dimensions AND pixels) and paste in
    // place, not drop a fresh layer at 0,0.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createDocument(page, 600, 400, true);
    await page.waitForTimeout(300);

    await drawEllipse(page, 450, 300, 40, 30, { r: 255, g: 128, b: 0 });

    await setSelection(page, 410, 270, 80, 60);
    await page.waitForTimeout(100);
    await page.keyboard.press(`${mod}+KeyC`);
    await page.waitForTimeout(200);

    const afterCopy = await getEditorState(page);
    expect(afterCopy.clipboard).not.toBeNull();
    const offsetX = afterCopy.clipboard!.offsetX;
    const offsetY = afterCopy.clipboard!.offsetY;
    expect(offsetX).toBeGreaterThanOrEqual(410);
    expect(offsetY).toBeGreaterThanOrEqual(270);

    // copy() writes the real copied pixels to the system clipboard asynchronously.
    await page.waitForFunction(async () => {
      try {
        const items = await navigator.clipboard.read();
        return items.some((it) => it.types.some((t) => t.startsWith('image/')));
      } catch {
        return false;
      }
    }, undefined, { timeout: 5000 });

    // Dispatch a native paste event carrying the *actual* PNG the OS clipboard
    // now holds — content that matches the internal clipboard pixel-for-pixel.
    await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      let blob: Blob | null = null;
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) {
          blob = await it.getType(type);
          break;
        }
      }
      if (!blob) throw new Error('no image on system clipboard');
      const file = new File([blob], 'image.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      window.dispatchEvent(evt);
    });

    await page.waitForFunction(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ name: string }> } };
      };
      return store.getState().document.layers.some((l) => l.name === 'Pasted Layer');
    }, { timeout: 5000 });

    const state = await getEditorState(page);
    const pastedLayer = state.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();

    // The bug: system-clipboard paste-back dropped the layer at 0,0.
    // The fix: it pastes in place at the copied offset.
    expect(pastedLayer!.x).toBe(offsetX);
    expect(pastedLayer!.y).toBe(offsetY);
    expect(pastedLayer!.x).not.toBe(0);
    expect(pastedLayer!.y).not.toBe(0);
  });

  test('external image matching the copied dimensions still pastes as a new external layer at 0,0', async ({ page }) => {
    // Guards the content-verification path: a *different* image that merely
    // shares the copied dimensions must NOT be substituted with the internal
    // clipboard's pixels — it is genuinely external and pastes at 0,0.
    await createDocument(page, 600, 400, true);
    await page.waitForTimeout(300);

    await drawEllipse(page, 450, 300, 40, 30, { r: 255, g: 128, b: 0 });
    await setSelection(page, 410, 270, 80, 60);
    await page.waitForTimeout(100);
    await page.keyboard.press(`${mod}+KeyC`);
    await page.waitForTimeout(200);

    const afterCopy = await getEditorState(page);
    expect(afterCopy.clipboard).not.toBeNull();
    const clipW = afterCopy.clipboard!.width;
    const clipH = afterCopy.clipboard!.height;

    // A solid blue PNG of the same dimensions — same size, different content.
    await page.evaluate(async ({ w, h }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgba(0,0,255,1)';
      ctx.fillRect(0, 0, w, h);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      const file = new File([blob], 'image.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      window.dispatchEvent(evt);
    }, { w: clipW, h: clipH });

    await page.waitForFunction(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ name: string }> } };
      };
      return store.getState().document.layers.some((l) => l.name === 'Pasted Layer');
    }, { timeout: 5000 });

    const state = await getEditorState(page);
    const pastedLayer = state.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();
    // External image → pasted via pasteOrOpenBlob at the origin, not in place.
    expect(pastedLayer!.x).toBe(0);
    expect(pastedLayer!.y).toBe(0);
  });
});

// ===========================================================================
// Bug 2: Cut text, paste gets stale clipboard content
// ===========================================================================

test.describe('Cut text then paste preserves correct clipboard', () => {
  test('cut text content and paste returns the same content, not stale data', async ({ page }) => {
    // 1. New doc
    await createDocument(page, 800, 400, true);
    await page.waitForTimeout(300);

    // 2. Draw an initial shape (this will be "old" clipboard content)
    await drawEllipse(page, 200, 200, 60, 40, { r: 255, g: 0, b: 0 });

    // Copy the ellipse to populate clipboard with "old" content
    await setSelection(page, 140, 160, 120, 80);
    await page.keyboard.press(`${mod}+KeyC`);
    await page.waitForTimeout(200);

    // Clear selection
    await page.keyboard.press(`${mod}+KeyD`);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-text-initial.png' });

    // 3. Add text — use text tool to create a text layer
    await selectTool(page, 'text');
    await page.evaluate(() => {
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setTextSetting: (key: 'fontSize' | 'fontFamily', value: number | string) => void;
        };
      };
      const s = ts.getState();
      s.setTextSetting('fontSize', 80);
      s.setTextSetting('fontFamily', 'Inter');
    });
    await setForegroundColor(page, 0, 0, 0);

    const textPos = await docToScreen(page, 400, 150);
    await page.mouse.click(textPos.x, textPos.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('HELLO');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(500);

    // Find the text layer
    const textLayerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string; name: string }> };
        };
      };
      const layers = store.getState().document.layers;
      return layers.find((l) => l.name.startsWith('Text'))?.id ?? '';
    });
    expect(textLayerId).not.toBe('');

    // Select the text layer
    await page.locator(`[data-layer-id="${textLayerId}"]`).click();
    await page.waitForTimeout(200);

    // Count text pixels before cut
    const textPixelsBefore = await countLayerOpaquePixels(page, textLayerId);
    expect(textPixelsBefore).toBeGreaterThan(100);

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-text-with-text.png' });

    // 4. Marquee around part of the text
    await setSelection(page, 350, 100, 200, 150);
    await page.waitForTimeout(200);

    // 5. Cut the selected text region
    await page.keyboard.press(`${mod}+KeyX`);
    await page.waitForTimeout(300);

    // Verify clipboard was updated (not still the old ellipse data)
    const stateAfterCut = await getEditorState(page);
    expect(stateAfterCut.clipboard).not.toBeNull();

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-text-after-cut.png' });

    // 6. Paste
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-text-after-paste.png' });

    // 7. Verify: the pasted content should be the TEXT pixels, not the old ellipse.
    //    The clipboard offset should correspond to the text selection area (350+, 100+),
    //    not the old ellipse position (140, 160).
    expect(stateAfterCut.clipboard!.offsetX).toBeGreaterThanOrEqual(350);
    expect(stateAfterCut.clipboard!.offsetY).toBeGreaterThanOrEqual(100);

    const stateAfterPaste = await getEditorState(page);
    const pastedLayer = stateAfterPaste.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();

    const pastedPixels = await countLayerOpaquePixels(page, pastedLayer!.id);
    expect(pastedPixels).toBeGreaterThan(0);
  });

  test('undo after cut does not corrupt clipboard on subsequent paste', async ({ page }) => {
    await createDocument(page, 600, 400, true);
    await page.waitForTimeout(300);

    // Draw a green ellipse on layer 1
    await drawEllipse(page, 150, 200, 50, 40, { r: 0, g: 200, b: 0 });

    // Draw a red ellipse on a new layer
    await addLayer(page);
    await drawEllipse(page, 400, 200, 50, 40, { r: 200, g: 0, b: 0 });

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-undo-initial.png' });

    // Select and cut the red ellipse from the active layer
    await setSelection(page, 350, 160, 100, 80);
    await page.keyboard.press(`${mod}+KeyX`);
    await page.waitForTimeout(300);

    // Clipboard should have the red ellipse content
    const clipAfterCut = await getEditorState(page);
    expect(clipAfterCut.clipboard).not.toBeNull();
    const cutOffsetX = clipAfterCut.clipboard!.offsetX;
    const cutOffsetY = clipAfterCut.clipboard!.offsetY;

    // Undo the cut (restores the red ellipse to the layer)
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.waitForTimeout(300);

    // Paste — should still paste the cut content (red ellipse region),
    // not some other stale data
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/cut-paste-undo-after-paste.png' });

    const stateAfterPaste = await getEditorState(page);
    const pastedLayer = stateAfterPaste.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();

    // Pasted content should exist and be positioned near the cut area
    const pastedPixels = await countLayerOpaquePixels(page, pastedLayer!.id);
    expect(pastedPixels).toBeGreaterThan(0);
    expect(pastedLayer!.x).toBeGreaterThanOrEqual(cutOffsetX);
    expect(pastedLayer!.y).toBeGreaterThanOrEqual(cutOffsetY);
  });
});

// ===========================================================================
// Undo/redo integrity after many mixed operations
// ===========================================================================

test.describe('Undo/redo stress test', () => {
  test('undo all then redo all after ~15 actions ends with red fill intact', async ({ page }) => {
    test.setTimeout(120000);
    // 1. New transparent doc
    await createDocument(page, 500, 400, true);
    await page.waitForTimeout(300);

    // --- Action 1: draw red ellipse ---
    await drawEllipse(page, 120, 150, 50, 40, { r: 255, g: 0, b: 0 });

    // --- Action 2: add layer ---
    await addLayer(page);

    // --- Action 3: draw blue rect on new layer ---
    await drawRect(page, 200, 50, 150, 100, { r: 0, g: 0, b: 255 });

    // --- Action 4: add layer ---
    await addLayer(page);

    // --- Action 5: draw green ellipse ---
    await drawEllipse(page, 380, 200, 45, 35, { r: 0, g: 200, b: 0 });

    await page.screenshot({ path: 'e2e/screenshots/undo-redo-stress-step5.png' });

    // --- Action 6: select part of canvas and cut ---
    await setSelection(page, 340, 160, 90, 80);
    await page.waitForTimeout(100);
    await page.keyboard.press(`${mod}+KeyX`);
    await page.waitForTimeout(200);

    // --- Action 7: paste ---
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(300);

    // --- Action 8: deselect ---
    await page.keyboard.press(`${mod}+KeyD`);
    await page.waitForTimeout(100);

    // --- Action 9: move the pasted layer ---
    const pastedId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    await moveLayerTo(page, pastedId, 50, 300);
    await page.waitForTimeout(200);

    // --- Action 10: merge down ---
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(200);

    // --- Action 11: add another layer ---
    await addLayer(page);

    // --- Action 12: draw yellow rect ---
    await drawRect(page, 300, 250, 120, 80, { r: 255, g: 255, b: 0 });

    await page.screenshot({ path: 'e2e/screenshots/undo-redo-stress-step12.png' });

    // --- Action 13: select part and copy ---
    await setSelection(page, 310, 260, 60, 40);
    await page.waitForTimeout(100);
    await page.keyboard.press(`${mod}+KeyC`);
    await page.waitForTimeout(200);

    // --- Action 14: paste ---
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(300);

    // --- Action 15: merge down ---
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(200);

    // --- Final actions: add layer on top, fill with red ---
    await addLayer(page);
    await setForegroundColor(page, 255, 0, 0);
    // Select the entire canvas, then fill
    await selectTool(page, 'marquee-rect');
    const topLeft = await docToScreen(page, 0, 0);
    const botRight = await docToScreen(page, 500, 400);
    await page.mouse.move(topLeft.x, topLeft.y);
    await page.mouse.down();
    await page.mouse.move(botRight.x, botRight.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    await selectTool(page, 'fill');
    const center = await docToScreen(page, 250, 200);
    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(200);
    // Deselect
    await page.keyboard.press(`${mod}+KeyD`);
    await page.waitForTimeout(100);

    await page.screenshot({ path: 'e2e/screenshots/undo-redo-stress-filled-red.png' });

    // Snapshot: composited canvas should be entirely red
    const redSnap = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      return readFn();
    });
    let redCount = 0;
    for (let i = 0; i < redSnap.pixels.length; i += 4) {
      if (redSnap.pixels[i]! > 200 && redSnap.pixels[i + 1]! < 50 && redSnap.pixels[i + 2]! < 50 && redSnap.pixels[i + 3]! > 200) {
        redCount++;
      }
    }
    // Composited pixels span the full viewport, not just the document.
    // The document is 500x400 = 200000 pixels; assert most of those are red.
    const docPixels = 500 * 400;
    expect(redCount).toBeGreaterThan(docPixels * 0.95);

    // Record undo stack depth so we know how many undos to send
    const undoDepth = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undoStack: unknown[] };
      };
      return store.getState().undoStack.length;
    });

    // --- Undo ALL the way back to the original blank document ---
    for (let i = 0; i < undoDepth; i++) {
      await undo(page);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/undo-redo-stress-undone.png' });

    // After full undo: should be back to the original state (transparent doc,
    // single background layer, no shapes)
    const undoneSnap = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      return readFn();
    });
    let undoneRedCount = 0;
    for (let i = 0; i < undoneSnap.pixels.length; i += 4) {
      if (undoneSnap.pixels[i]! > 200 && undoneSnap.pixels[i + 1]! < 50 && undoneSnap.pixels[i + 2]! < 50 && undoneSnap.pixels[i + 3]! > 200) {
        undoneRedCount++;
      }
    }
    expect(undoneRedCount).toBe(0);

    // Record redo stack depth
    const redoDepth = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { redoStack: unknown[] };
      };
      return store.getState().redoStack.length;
    });

    // --- Redo ALL the way back to the red-filled end state ---
    for (let i = 0; i < redoDepth; i++) {
      await redo(page);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/undo-redo-stress-redone.png' });

    // After full redo: should be back to the all-red state
    const redoneSnap = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      return readFn();
    });
    let redoneRedCount = 0;
    for (let i = 0; i < redoneSnap.pixels.length; i += 4) {
      if (redoneSnap.pixels[i]! > 200 && redoneSnap.pixels[i + 1]! < 50 && redoneSnap.pixels[i + 2]! < 50 && redoneSnap.pixels[i + 3]! > 200) {
        redoneRedCount++;
      }
    }
    expect(redoneRedCount).toBeGreaterThan(docPixels * 0.95);
  });
});
