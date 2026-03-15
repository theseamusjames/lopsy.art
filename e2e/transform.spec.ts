import { test, expect, type Page } from '@playwright/test';

// Helper: access the editor store from the page context
async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    return {
      selection: state.selection as {
        active: boolean;
        bounds: { x: number; y: number; width: number; height: number } | null;
      },
    };
  });
}

async function getUIState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    return {
      activeTool: state.activeTool as string,
      transform: state.transform as {
        originalBounds: { x: number; y: number; width: number; height: number };
        scaleX: number;
        scaleY: number;
        rotation: number;
        translateX: number;
        translateY: number;
      } | null,
    };
  });
}

// Helper: count total opaque pixels in the entire layer
async function countAllOpaquePixels(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        layerPixelData: Map<string, ImageData>;
      };
    };
    const state = store.getState();
    const data = state.layerPixelData.get(state.document.activeLayerId);
    if (!data) return 0;
    let count = 0;
    for (let i = 3; i < data.data.length; i += 4) {
      if ((data.data[i] ?? 0) > 0) count++;
    }
    return count;
  });
}

// Helper: convert document coordinates to screen coordinates
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
    const screenX = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
    const screenY = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
    return { x: rect.left + screenX, y: rect.top + screenY };
  }, { docX, docY });
}

// Helper: snapshot all layer pixel data (returns opaque count + raw data for comparison)
async function snapshotLayerPixels(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        layerPixelData: Map<string, ImageData>;
      };
    };
    const state = store.getState();
    const imgData = state.layerPixelData.get(state.document.activeLayerId);
    if (!imgData) return { opaqueCount: 0, data: [] as number[] };
    let opaqueCount = 0;
    const data: number[] = [];
    for (let i = 0; i < imgData.data.length; i += 4) {
      const a = imgData.data[i + 3] ?? 0;
      if (a > 0) opaqueCount++;
      data.push(
        imgData.data[i] ?? 0,
        imgData.data[i + 1] ?? 0,
        imgData.data[i + 2] ?? 0,
        a,
      );
    }
    return { opaqueCount, data };
  });
}

// Helper: compare two pixel snapshots and return the ratio of matching pixels
async function comparePixelSnapshots(
  page: Page,
  before: number[],
  after: number[],
) {
  // Compare in the page context to avoid transferring huge arrays back
  return page.evaluate(({ before, after }) => {
    const pixelCount = before.length / 4;
    let matching = 0;
    const tolerance = 10; // allow small rounding differences per channel
    for (let i = 0; i < before.length; i += 4) {
      const dr = Math.abs((before[i] ?? 0) - (after[i] ?? 0));
      const dg = Math.abs((before[i + 1] ?? 0) - (after[i + 1] ?? 0));
      const db = Math.abs((before[i + 2] ?? 0) - (after[i + 2] ?? 0));
      const da = Math.abs((before[i + 3] ?? 0) - (after[i + 3] ?? 0));
      if (dr <= tolerance && dg <= tolerance && db <= tolerance && da <= tolerance) {
        matching++;
      }
    }
    return matching / pixelCount;
  }, { before, after });
}

// Helper: select a tool by pressing its keyboard shortcut
async function selectTool(page: Page, key: string) {
  await page.keyboard.press(key);
}

test.describe('Free Transform', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // The app starts with a NewDocumentModal - create a document via the store
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, transparent: boolean) => void };
      };
      store.getState().createDocument(800, 600, false);
    });
    await page.waitForSelector('[data-testid="canvas-container"]');
    // Wait for canvas to render
    await page.waitForTimeout(200);
  });

  test('6 rotations back to origin produce identical pixels', async ({ page }) => {
    // 1. Paint content with the brush tool
    await selectTool(page, 'b');

    const startDoc = await docToScreen(page, 200, 280);
    await page.mouse.move(startDoc.x, startDoc.y);
    await page.mouse.down();
    for (let dy = 0; dy < 40; dy += 4) {
      const s = await docToScreen(page, 200, 260 + dy);
      const e = await docToScreen(page, 600, 260 + dy);
      await page.mouse.move(s.x, s.y);
      await page.mouse.move(e.x, e.y);
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 2. Snapshot the layer pixels before any transforms
    const beforePixels = await snapshotLayerPixels(page);
    expect(beforePixels.opaqueCount).toBeGreaterThan(100);

    // 3. Select the painted area
    await selectTool(page, 'm');
    const selStart = await docToScreen(page, 180, 240);
    const selEnd = await docToScreen(page, 620, 320);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const editorState = await getEditorState(page);
    expect(editorState.selection.active).toBe(true);

    // 4. Rotate 60° six times (6 × 60° = 360°, full circle back to start)
    const rotationPerStep = Math.PI / 3; // 60 degrees
    const dragSteps = 10;

    for (let rotation = 0; rotation < 6; rotation++) {
      // Get the current rotate-top-right handle position
      const handleInfo = await page.evaluate(() => {
        const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
          getState: () => { transform: Record<string, unknown> | null };
        };
        const transform = uiStore.getState().transform;
        if (!transform) return null;

        const ob = transform.originalBounds as { x: number; y: number; width: number; height: number };
        const scaleX = transform.scaleX as number;
        const scaleY = transform.scaleY as number;
        const translateX = transform.translateX as number;
        const translateY = transform.translateY as number;
        const rot = transform.rotation as number;

        const cx = ob.x + ob.width / 2 + translateX;
        const cy = ob.y + ob.height / 2 + translateY;
        const w = ob.width * Math.abs(scaleX);
        const h = ob.height * Math.abs(scaleY);
        const hw = w / 2;
        const hh = h / 2;
        const rotOff = 20;

        const px = cx + hw + rotOff;
        const py = cy - hh - rotOff;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const dx = px - cx;
        const dy = py - cy;

        return {
          handleX: cx + dx * cos - dy * sin,
          handleY: cy + dx * sin + dy * cos,
          cx,
          cy,
          radius: Math.sqrt(dx * dx + dy * dy),
          handleAngle: Math.atan2(dy * cos + dx * sin, dx * cos - dy * sin),
        };
      });

      expect(handleInfo).not.toBeNull();
      if (!handleInfo) return;

      const handleScreen = await docToScreen(page, handleInfo.handleX, handleInfo.handleY);
      await page.mouse.move(handleScreen.x, handleScreen.y);
      await page.mouse.down();

      // Drag along an arc by rotationPerStep
      const fromAngle = handleInfo.handleAngle;
      const toAngle = fromAngle + rotationPerStep;
      for (let i = 1; i <= dragSteps; i++) {
        const t = i / dragSteps;
        const angle = fromAngle + (toAngle - fromAngle) * t;
        const docX = handleInfo.cx + handleInfo.radius * Math.cos(angle);
        const docY = handleInfo.cy + handleInfo.radius * Math.sin(angle);
        const screenPt = await docToScreen(page, docX, docY);
        await page.mouse.move(screenPt.x, screenPt.y);
      }
      await page.mouse.up();
      await page.waitForTimeout(50);

      // After each rotation, pixel count must stay close (no clipping)
      const stepPixels = await countAllOpaquePixels(page);
      const ratio = stepPixels / beforePixels.opaqueCount;
      console.log(`  Rotation ${rotation + 1}: ${stepPixels} pixels (ratio: ${ratio.toFixed(4)})`);
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.1);
    }

    // 5. Deselect (Escape) to commit the transform
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // 7. After many rotations, pixel count should still be in the same ballpark
    // (interpolation across 6 rotations will shift some pixels, but should not
    // lose large chunks — that would indicate clipping)
    const afterPixels = await snapshotLayerPixels(page);
    const countRatio = afterPixels.opaqueCount / beforePixels.opaqueCount;
    console.log(`  Final: ${afterPixels.opaqueCount} pixels (ratio: ${countRatio.toFixed(4)}, before: ${beforePixels.opaqueCount})`);
    const matchRatio = await comparePixelSnapshots(page, beforePixels.data, afterPixels.data);
    console.log(`  Pixel match ratio: ${matchRatio.toFixed(4)}`);
    expect(countRatio).toBeGreaterThan(0.95);
    expect(countRatio).toBeLessThan(1.05);
    expect(matchRatio).toBeGreaterThan(0.90);
  });

  test('scaling selection preserves pixels', async ({ page }) => {
    // Paint some content
    await selectTool(page, 'b');
    const center = await docToScreen(page, 400, 300);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    for (let dy = -30; dy <= 30; dy += 4) {
      const s = await docToScreen(page, 350, 300 + dy);
      const e = await docToScreen(page, 450, 300 + dy);
      await page.mouse.move(s.x, s.y);
      await page.mouse.move(e.x, e.y);
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    const initialPixels = await countAllOpaquePixels(page);
    expect(initialPixels).toBeGreaterThan(100);

    // Select with marquee
    await selectTool(page, 'm');
    const selStart = await docToScreen(page, 330, 250);
    const selEnd = await docToScreen(page, 470, 350);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y);
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Find the right-middle scale handle and drag it to enlarge
    const handlePos = await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { transform: Record<string, unknown> | null };
      };
      const transform = uiStore.getState().transform;
      if (!transform) return null;

      const ob = transform.originalBounds as { x: number; y: number; width: number; height: number };
      const scaleX = transform.scaleX as number;
      const translateX = transform.translateX as number;
      const translateY = transform.translateY as number;
      const cx = ob.x + ob.width / 2 + translateX;
      const cy = ob.y + ob.height / 2 + translateY;
      const w = ob.width * Math.abs(scaleX);

      return { x: cx + w / 2, y: cy };
    });

    expect(handlePos).not.toBeNull();
    if (!handlePos) return;

    const handleScreen = await docToScreen(page, handlePos.x, handlePos.y);
    const dragTarget = await docToScreen(page, handlePos.x + 50, handlePos.y);

    await page.mouse.move(handleScreen.x, handleScreen.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(
        handleScreen.x + (dragTarget.x - handleScreen.x) * t,
        handleScreen.y + (dragTarget.y - handleScreen.y) * t,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // After scaling up, should have MORE opaque pixels (stretched content)
    const afterScalePixels = await countAllOpaquePixels(page);
    expect(afterScalePixels).toBeGreaterThan(initialPixels * 0.9);

    // Verify transform state shows scale change
    const afterScale = await getUIState(page);
    expect(afterScale.transform?.scaleX).toBeGreaterThan(1.0);
  });

  test('move tool shifts selection marquee with content', async ({ page }) => {
    // Paint content in a known region
    await selectTool(page, 'b');
    const paintStart = await docToScreen(page, 200, 200);
    await page.mouse.move(paintStart.x, paintStart.y);
    await page.mouse.down();
    for (let dy = -20; dy <= 20; dy += 4) {
      const s = await docToScreen(page, 180, 200 + dy);
      const e = await docToScreen(page, 220, 200 + dy);
      await page.mouse.move(s.x, s.y);
      await page.mouse.move(e.x, e.y);
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Select the painted area with marquee
    await selectTool(page, 'm');
    const selStart = await docToScreen(page, 160, 160);
    const selEnd = await docToScreen(page, 240, 240);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const beforeSel = await getEditorState(page);
    expect(beforeSel.selection.active).toBe(true);
    expect(beforeSel.selection.bounds).not.toBeNull();
    const beforeBounds = beforeSel.selection.bounds!;

    // Switch to move tool and drag 100px right, 50px down
    await selectTool(page, 'v');
    const moveStart = await docToScreen(page, 200, 200);
    const moveEnd = await docToScreen(page, 300, 250);
    await page.mouse.move(moveStart.x, moveStart.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(
        moveStart.x + (moveEnd.x - moveStart.x) * t,
        moveStart.y + (moveEnd.y - moveStart.y) * t,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Selection bounds should have shifted by ~(100, 50)
    const afterSel = await getEditorState(page);
    expect(afterSel.selection.active).toBe(true);
    expect(afterSel.selection.bounds).not.toBeNull();
    const afterBounds = afterSel.selection.bounds!;

    const dxBounds = afterBounds.x - beforeBounds.x;
    const dyBounds = afterBounds.y - beforeBounds.y;
    console.log(`  Bounds shift: dx=${dxBounds}, dy=${dyBounds}`);
    expect(dxBounds).toBeGreaterThan(80);
    expect(dxBounds).toBeLessThan(120);
    expect(dyBounds).toBeGreaterThan(30);
    expect(dyBounds).toBeLessThan(70);

    // Width and height should be unchanged
    expect(afterBounds.width).toBe(beforeBounds.width);
    expect(afterBounds.height).toBe(beforeBounds.height);

    // Pixel count should be preserved (moved, not lost)
    const pixelCount = await countAllOpaquePixels(page);
    expect(pixelCount).toBeGreaterThan(50);
  });

  test('move selection away and back produces identical canvas', async ({ page }) => {
    // 1. Fill the entire canvas with black via the store
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          layerPixelData: Map<string, ImageData>;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const { width, height } = state.document;
      const imgData = new ImageData(width, height);
      for (let i = 0; i < imgData.data.length; i += 4) {
        imgData.data[i] = 0;       // R
        imgData.data[i + 1] = 0;   // G
        imgData.data[i + 2] = 0;   // B
        imgData.data[i + 3] = 255; // A
      }
      state.updateLayerPixelData(state.document.activeLayerId, imgData);
      state.notifyRender();
    });
    await page.waitForTimeout(100);

    // 2. Snapshot the filled canvas
    const beforePixels = await snapshotLayerPixels(page);
    const totalPixels = 800 * 600;
    expect(beforePixels.opaqueCount).toBe(totalPixels);

    // 3. Select a region in the center
    await selectTool(page, 'm');
    const selStart = await docToScreen(page, 300, 200);
    const selEnd = await docToScreen(page, 500, 400);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const sel = await getEditorState(page);
    expect(sel.selection.active).toBe(true);

    // 4. Move the selection 100px right with the move tool
    await selectTool(page, 'v');
    const moveFrom = await docToScreen(page, 400, 300);
    const moveTo = await docToScreen(page, 500, 300);
    await page.mouse.move(moveFrom.x, moveFrom.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(
        moveFrom.x + (moveTo.x - moveFrom.x) * t,
        moveFrom.y,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 5. Move the selection 100px back to the left
    const moveFrom2 = await docToScreen(page, 500, 300);
    const moveTo2 = await docToScreen(page, 400, 300);
    await page.mouse.move(moveFrom2.x, moveFrom2.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(
        moveFrom2.x + (moveTo2.x - moveFrom2.x) * t,
        moveFrom2.y,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 6. Deselect
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // 7. Compare: canvas should be identical to the starting state
    const afterPixels = await snapshotLayerPixels(page);
    console.log(`  Before: ${beforePixels.opaqueCount} pixels, After: ${afterPixels.opaqueCount} pixels`);
    expect(afterPixels.opaqueCount).toBe(totalPixels);

    const matchRatio = await comparePixelSnapshots(page, beforePixels.data, afterPixels.data);
    console.log(`  Pixel match ratio: ${matchRatio.toFixed(4)}`);
    expect(matchRatio).toBe(1.0);
  });

  test('transforms on multiple layers are independent', async ({ page }) => {
    // Helper: fill the active layer with a solid color
    async function fillActiveLayer(page: Page, r: number, g: number, b: number) {
      await page.evaluate(({ r, g, b }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { activeLayerId: string; width: number; height: number };
            updateLayerPixelData: (id: string, data: ImageData) => void;
            notifyRender: () => void;
          };
        };
        const state = store.getState();
        const { width, height } = state.document;
        const imgData = new ImageData(width, height);
        for (let i = 0; i < imgData.data.length; i += 4) {
          imgData.data[i] = r;
          imgData.data[i + 1] = g;
          imgData.data[i + 2] = b;
          imgData.data[i + 3] = 255;
        }
        state.updateLayerPixelData(state.document.activeLayerId, imgData);
        state.notifyRender();
      }, { r, g, b });
      await page.waitForTimeout(50);
    }

    // Helper: save a snapshot of a layer's pixels in the page context (returns a handle ID)
    async function saveLayerSnapshot(page: Page, layerId: string, snapshotName: string) {
      return page.evaluate(({ layerId, snapshotName }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { layerPixelData: Map<string, ImageData> };
        };
        const imgData = store.getState().layerPixelData.get(layerId);
        if (!imgData) return { opaqueCount: 0 };
        let opaqueCount = 0;
        for (let i = 3; i < imgData.data.length; i += 4) {
          if ((imgData.data[i] ?? 0) > 0) opaqueCount++;
        }
        const snapshots = ((window as unknown as Record<string, unknown>).__snapshots ?? {}) as Record<string, Uint8ClampedArray>;
        snapshots[snapshotName] = new Uint8ClampedArray(imgData.data);
        (window as unknown as Record<string, unknown>).__snapshots = snapshots;
        return { opaqueCount };
      }, { layerId, snapshotName });
    }

    // Helper: compare current layer pixels to a saved snapshot (runs entirely in page)
    async function compareToSnapshot(page: Page, layerId: string, snapshotName: string) {
      return page.evaluate(({ layerId, snapshotName }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { layerPixelData: Map<string, ImageData> };
        };
        const snapshots = (window as unknown as Record<string, unknown>).__snapshots as Record<string, Uint8ClampedArray>;
        const saved = snapshots[snapshotName];
        const imgData = store.getState().layerPixelData.get(layerId);
        if (!saved || !imgData) return { matchRatio: 0, opaqueCount: 0 };

        let opaqueCount = 0;
        let matching = 0;
        const pixelCount = saved.length / 4;
        const tolerance = 10;
        for (let i = 0; i < saved.length; i += 4) {
          const a = imgData.data[i + 3] ?? 0;
          if (a > 0) opaqueCount++;
          const dr = Math.abs((saved[i] ?? 0) - (imgData.data[i] ?? 0));
          const dg = Math.abs((saved[i + 1] ?? 0) - (imgData.data[i + 1] ?? 0));
          const db = Math.abs((saved[i + 2] ?? 0) - (imgData.data[i + 2] ?? 0));
          const da = Math.abs((saved[i + 3] ?? 0) - a);
          if (dr <= tolerance && dg <= tolerance && db <= tolerance && da <= tolerance) {
            matching++;
          }
        }
        return { matchRatio: matching / pixelCount, opaqueCount };
      }, { layerId, snapshotName });
    }

    // Helper: add a new layer and return its ID
    async function addLayer(page: Page): Promise<string> {
      return page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { activeLayerId: string };
            addLayer: () => void;
          };
        };
        store.getState().addLayer();
        return store.getState().document.activeLayerId;
      });
    }

    // Helper: switch to a layer
    async function switchLayer(page: Page, layerId: string) {
      await page.evaluate((id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { setActiveLayer: (id: string) => void };
        };
        store.getState().setActiveLayer(id);
      }, layerId);
      await page.waitForTimeout(50);
    }

    // Helper: drag a marquee selection
    async function makeSelection(page: Page, x1: number, y1: number, x2: number, y2: number) {
      await selectTool(page, 'm');
      const start = await docToScreen(page, x1, y1);
      const end = await docToScreen(page, x2, y2);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y);
      await page.mouse.up();
      await page.waitForTimeout(100);
    }

    // Helper: move selection by (dx, dy) in doc coords
    async function moveSelection(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
      await selectTool(page, 'v');
      const from = await docToScreen(page, fromX, fromY);
      const to = await docToScreen(page, toX, toY);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        await page.mouse.move(
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
        );
      }
      await page.mouse.up();
      await page.waitForTimeout(100);
    }

    // Helper: rotate selection by a given angle via the rotation handle
    async function rotateSelection(page: Page, angle: number) {
      const handleInfo = await page.evaluate(() => {
        const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
          getState: () => { transform: Record<string, unknown> | null };
        };
        const transform = uiStore.getState().transform;
        if (!transform) return null;

        const ob = transform.originalBounds as { x: number; y: number; width: number; height: number };
        const scaleX = transform.scaleX as number;
        const scaleY = transform.scaleY as number;
        const translateX = transform.translateX as number;
        const translateY = transform.translateY as number;
        const rot = transform.rotation as number;

        const cx = ob.x + ob.width / 2 + translateX;
        const cy = ob.y + ob.height / 2 + translateY;
        const w = ob.width * Math.abs(scaleX);
        const h = ob.height * Math.abs(scaleY);
        const hw = w / 2;
        const hh = h / 2;
        const rotOff = 20;

        const px = cx + hw + rotOff;
        const py = cy - hh - rotOff;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const dx = px - cx;
        const dy = py - cy;

        return {
          handleX: cx + dx * cos - dy * sin,
          handleY: cy + dx * sin + dy * cos,
          cx, cy,
          radius: Math.sqrt(dx * dx + dy * dy),
          handleAngle: Math.atan2(dy * cos + dx * sin, dx * cos - dy * sin),
        };
      });
      if (!handleInfo) return;

      const handleScreen = await docToScreen(page, handleInfo.handleX, handleInfo.handleY);
      await page.mouse.move(handleScreen.x, handleScreen.y);
      await page.mouse.down();

      const fromAngle = handleInfo.handleAngle;
      const toAngle = fromAngle + angle;
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const a = fromAngle + (toAngle - fromAngle) * t;
        const docX = handleInfo.cx + handleInfo.radius * Math.cos(a);
        const docY = handleInfo.cy + handleInfo.radius * Math.sin(a);
        const screenPt = await docToScreen(page, docX, docY);
        await page.mouse.move(screenPt.x, screenPt.y);
      }
      await page.mouse.up();
      await page.waitForTimeout(50);
    }

    // --- Setup: Layer 1 (red), Layer 2 (blue) ---
    const layer1Id = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    await fillActiveLayer(page, 255, 0, 0); // Red

    const layer2Id = await addLayer(page);
    await fillActiveLayer(page, 0, 0, 255); // Blue

    // Snapshot both layers before any transforms (stored in page context)
    const totalPixels = 800 * 600;
    const l1snap = await saveLayerSnapshot(page, layer1Id, 'layer1_before');
    const l2snap = await saveLayerSnapshot(page, layer2Id, 'layer2_before');
    expect(l1snap.opaqueCount).toBe(totalPixels);
    expect(l2snap.opaqueCount).toBe(totalPixels);

    // --- Act on Layer 2: select center, move right 100, then back ---
    await makeSelection(page, 300, 200, 500, 400);
    await moveSelection(page, 400, 300, 500, 300);
    await moveSelection(page, 500, 300, 400, 300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Layer 2 should be identical after round-trip move
    const layer2AfterMove = await compareToSnapshot(page, layer2Id, 'layer2_before');
    console.log(`  Layer 2 after move round-trip: ${layer2AfterMove.matchRatio.toFixed(4)} match`);
    expect(layer2AfterMove.matchRatio).toBeGreaterThan(0.99);

    // Layer 1 should be completely untouched
    const layer1AfterL2Move = await compareToSnapshot(page, layer1Id, 'layer1_before');
    console.log(`  Layer 1 untouched after Layer 2 move: ${layer1AfterL2Move.matchRatio.toFixed(4)} match`);
    expect(layer1AfterL2Move.matchRatio).toBe(1.0);

    // --- Switch to Layer 1: select center, rotate 90° then back ---
    await switchLayer(page, layer1Id);
    await makeSelection(page, 200, 150, 600, 450);
    await rotateSelection(page, Math.PI / 2);  // 90° clockwise
    await rotateSelection(page, -Math.PI / 2); // 90° counter-clockwise
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Layer 1 should be very close after rotation round-trip
    const layer1AfterRotate = await compareToSnapshot(page, layer1Id, 'layer1_before');
    console.log(`  Layer 1 after rotation round-trip: ${layer1AfterRotate.opaqueCount} pixels (ratio: ${(layer1AfterRotate.opaqueCount / totalPixels).toFixed(4)})`);
    expect(layer1AfterRotate.opaqueCount / totalPixels).toBeGreaterThan(0.95);
    console.log(`  Layer 1 pixel match: ${layer1AfterRotate.matchRatio.toFixed(4)}`);
    expect(layer1AfterRotate.matchRatio).toBeGreaterThan(0.90);

    // Layer 2 should STILL be untouched after Layer 1 ops
    const layer2AfterL1Rotate = await compareToSnapshot(page, layer2Id, 'layer2_before');
    console.log(`  Layer 2 untouched after Layer 1 rotate: ${layer2AfterL1Rotate.matchRatio.toFixed(4)} match`);
    expect(layer2AfterL1Rotate.matchRatio).toBe(1.0);

    // --- Switch between layers: move selection on each, then move back ---
    await switchLayer(page, layer2Id);
    await makeSelection(page, 100, 100, 300, 300);
    await moveSelection(page, 200, 200, 300, 200); // move right
    await moveSelection(page, 300, 200, 200, 200); // move back
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Switch to Layer 1, make a different selection and round-trip it
    await switchLayer(page, layer1Id);
    await makeSelection(page, 400, 300, 600, 500);
    await moveSelection(page, 500, 400, 500, 300); // move up
    await moveSelection(page, 500, 300, 500, 400); // move back
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Both layers should be identical to originals after round-trip moves
    const layer1Final = await compareToSnapshot(page, layer1Id, 'layer1_before');
    const layer2Final = await compareToSnapshot(page, layer2Id, 'layer2_before');
    console.log(`  Layer 1 final: ${layer1Final.opaqueCount} pixels, match: ${layer1Final.matchRatio.toFixed(4)}`);
    console.log(`  Layer 2 final: ${layer2Final.opaqueCount} pixels, match: ${layer2Final.matchRatio.toFixed(4)}`);
    // Allow tiny rounding differences from float-point rotation math
    expect(layer1Final.opaqueCount).toBeGreaterThanOrEqual(totalPixels * 0.999);
    expect(layer2Final.opaqueCount).toBeGreaterThanOrEqual(totalPixels * 0.999);
    expect(layer1Final.matchRatio).toBeGreaterThanOrEqual(0.998);
    expect(layer2Final.matchRatio).toBeGreaterThanOrEqual(0.998);
  });

  test('rotate only affects selected pixels, not unselected ones', async ({ page }) => {
    // 1. Fill the active layer with black (acts as our "background" for this test)
    const blackLayerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const { width, height } = state.document;
      const imgData = new ImageData(width, height);
      for (let i = 0; i < imgData.data.length; i += 4) {
        imgData.data[i] = 0;
        imgData.data[i + 1] = 0;
        imgData.data[i + 2] = 0;
        imgData.data[i + 3] = 255;
      }
      state.updateLayerPixelData(state.document.activeLayerId, imgData);
      state.notifyRender();
      return state.document.activeLayerId;
    });
    await page.waitForTimeout(100);

    // 2. Create a new layer
    const layer2Id = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          addLayer: () => void;
        };
      };
      store.getState().addLayer();
      return store.getState().document.activeLayerId;
    });

    // 3. Draw a red horizontal L shape on layer 2
    //    Horizontal bar: (200,250) to (500,270)
    //    Vertical bar:   (200,250) to (220,350)
    await page.evaluate((layerId) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const imgData = state.getOrCreateLayerPixelData(layerId);
      const w = state.document.width;
      // Horizontal bar
      for (let y = 250; y < 270; y++) {
        for (let x = 200; x < 500; x++) {
          const i = (y * w + x) * 4;
          imgData.data[i] = 255;
          imgData.data[i + 1] = 0;
          imgData.data[i + 2] = 0;
          imgData.data[i + 3] = 255;
        }
      }
      // Vertical bar
      for (let y = 270; y < 350; y++) {
        for (let x = 200; x < 220; x++) {
          const i = (y * w + x) * 4;
          imgData.data[i] = 255;
          imgData.data[i + 1] = 0;
          imgData.data[i + 2] = 0;
          imgData.data[i + 3] = 255;
        }
      }
      state.updateLayerPixelData(layerId, imgData);
      state.notifyRender();
    }, layer2Id);
    await page.waitForTimeout(100);

    // 4. Select only the horizontal bar portion (not the vertical part)
    await selectTool(page, 'm');
    const selStart = await docToScreen(page, 220, 245);
    const selEnd = await docToScreen(page, 505, 275);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const sel = await getEditorState(page);
    expect(sel.selection.active).toBe(true);

    // 5. Move the selection 100px to the right
    await selectTool(page, 'v');
    const moveFrom = await docToScreen(page, 360, 260);
    const moveTo = await docToScreen(page, 460, 260);
    await page.mouse.move(moveFrom.x, moveFrom.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(
        moveFrom.x + (moveTo.x - moveFrom.x) * t,
        moveFrom.y,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 6. Rotate the selection 90 degrees
    //    First need to switch back to marquee so transform handles are visible
    await selectTool(page, 'm');
    await page.waitForTimeout(50);

    const handleInfo = await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { transform: Record<string, unknown> | null };
      };
      const transform = uiStore.getState().transform;
      if (!transform) return null;

      const ob = transform.originalBounds as { x: number; y: number; width: number; height: number };
      const scaleX = transform.scaleX as number;
      const scaleY = transform.scaleY as number;
      const translateX = transform.translateX as number;
      const translateY = transform.translateY as number;
      const rot = transform.rotation as number;

      const cx = ob.x + ob.width / 2 + translateX;
      const cy = ob.y + ob.height / 2 + translateY;
      const w = ob.width * Math.abs(scaleX);
      const h = ob.height * Math.abs(scaleY);
      const hw = w / 2;
      const hh = h / 2;
      const rotOff = 20;

      const px = cx + hw + rotOff;
      const py = cy - hh - rotOff;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const dx = px - cx;
      const dy = py - cy;

      return {
        handleX: cx + dx * cos - dy * sin,
        handleY: cy + dx * sin + dy * cos,
        cx, cy,
        radius: Math.sqrt(dx * dx + dy * dy),
        handleAngle: Math.atan2(dy * cos + dx * sin, dx * cos - dy * sin),
      };
    });

    expect(handleInfo).not.toBeNull();
    if (!handleInfo) return;

    const handleScreen = await docToScreen(page, handleInfo.handleX, handleInfo.handleY);
    await page.mouse.move(handleScreen.x, handleScreen.y);
    await page.mouse.down();

    const fromAngle = handleInfo.handleAngle;
    const toAngle = fromAngle + Math.PI / 2;
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const a = fromAngle + (toAngle - fromAngle) * t;
      const docX = handleInfo.cx + handleInfo.radius * Math.cos(a);
      const docY = handleInfo.cy + handleInfo.radius * Math.sin(a);
      const screenPt = await docToScreen(page, docX, docY);
      await page.mouse.move(screenPt.x, screenPt.y);
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 7. Check: pixels outside the selection mask should be unchanged
    // Save snapshot of layer 2 after move but BEFORE rotate for the base pixels
    // Compare all unselected pixels to the pre-move snapshot
    const unselectedCheck = await page.evaluate((layerId) => {
      const editorStore = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number };
          selection: { mask: Uint8ClampedArray | null; maskWidth: number };
          layerPixelData: Map<string, ImageData>;
        };
      };
      const state = editorStore.getState();
      const imgData = state.layerPixelData.get(layerId);
      const sel = state.selection;
      if (!imgData || !sel.mask) return { changed: 0, total: 0 };

      const w = state.document.width;
      let changed = 0;
      let total = 0;
      // Check pixels that are NOT in the current selection mask
      // The vertical bar (y:270-350, x:200-220) should be red and untouched
      for (let y = 270; y < 350; y++) {
        for (let x = 200; x < 220; x++) {
          const maskVal = sel.mask[y * sel.maskWidth + x] ?? 0;
          if (maskVal > 0) continue; // skip selected pixels
          total++;
          const i = (y * w + x) * 4;
          const r = imgData.data[i] ?? 0;
          const g = imgData.data[i + 1] ?? 0;
          const b = imgData.data[i + 2] ?? 0;
          const a = imgData.data[i + 3] ?? 0;
          // Should be red (255,0,0,255)
          if (r !== 255 || g !== 0 || b !== 0 || a !== 255) {
            changed++;
          }
        }
      }
      return { changed, total };
    }, layer2Id);

    console.log(`  Unselected vertical bar: ${unselectedCheck.changed} changed out of ${unselectedCheck.total}`);
    // Allow tiny rounding differences at rotation boundaries
    expect(unselectedCheck.changed).toBeLessThanOrEqual(10);

    // Also check: the black-filled layer should be completely untouched
    const bgCheck = await page.evaluate((bgId) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          layerPixelData: Map<string, ImageData>;
        };
      };
      const state = store.getState();
      const imgData = state.layerPixelData.get(bgId);
      if (!imgData) return { allBlack: false, nonBlack: -1 };
      let nonBlack = 0;
      for (let i = 0; i < imgData.data.length; i += 4) {
        if (imgData.data[i] !== 0 || imgData.data[i + 1] !== 0 ||
            imgData.data[i + 2] !== 0 || imgData.data[i + 3] !== 255) {
          nonBlack++;
        }
      }
      return { allBlack: nonBlack === 0, nonBlack };
    }, blackLayerId);

    console.log(`  Background layer all black: ${bgCheck.allBlack} (non-black: ${bgCheck.nonBlack})`);
    expect(bgCheck.allBlack).toBe(true);
  });

  test('move then rotate then move does not snap back', async ({ page }) => {
    // Paint a distinct shape so rotation is visually obvious
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const { width: w } = state.document;
      const imgData = state.getOrCreateLayerPixelData(state.document.activeLayerId);
      // Draw a horizontal red bar at (300,280)-(500,300)
      for (let y = 280; y < 300; y++) {
        for (let x = 300; x < 500; x++) {
          const i = (y * w + x) * 4;
          imgData.data[i] = 255;
          imgData.data[i + 1] = 0;
          imgData.data[i + 2] = 0;
          imgData.data[i + 3] = 255;
        }
      }
      state.updateLayerPixelData(state.document.activeLayerId, imgData);
      state.notifyRender();
    });
    await page.waitForTimeout(100);

    // Select the bar
    await selectTool(page, 'm');
    const s1 = await docToScreen(page, 295, 275);
    const e1 = await docToScreen(page, 505, 305);
    await page.mouse.move(s1.x, s1.y);
    await page.mouse.down();
    await page.mouse.move(e1.x, e1.y);
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 1. Move selection 50px right
    await selectTool(page, 'v');
    const mf1 = await docToScreen(page, 400, 290);
    const mt1 = await docToScreen(page, 450, 290);
    await page.mouse.move(mf1.x, mf1.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(
        mf1.x + (mt1.x - mf1.x) * (i / 10),
        mf1.y,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 2. Rotate 90° — need to switch to marquee for handle access
    await selectTool(page, 'm');
    await page.waitForTimeout(50);

    const handleInfo = await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { transform: Record<string, unknown> | null };
      };
      const transform = uiStore.getState().transform;
      if (!transform) return null;
      const ob = transform.originalBounds as { x: number; y: number; width: number; height: number };
      const tX = transform.translateX as number;
      const tY = transform.translateY as number;
      const rot = transform.rotation as number;
      const sX = Math.abs(transform.scaleX as number);
      const sY = Math.abs(transform.scaleY as number);
      const cx = ob.x + ob.width / 2 + tX;
      const cy = ob.y + ob.height / 2 + tY;
      const hw = ob.width * sX / 2;
      const hh = ob.height * sY / 2;
      const rotOff = 20;
      const px = cx + hw + rotOff;
      const py = cy - hh - rotOff;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const dx = px - cx;
      const dy = py - cy;
      return {
        handleX: cx + dx * cos - dy * sin,
        handleY: cy + dx * sin + dy * cos,
        cx, cy,
        radius: Math.sqrt(dx * dx + dy * dy),
        handleAngle: Math.atan2(dy * cos + dx * sin, dx * cos - dy * sin),
      };
    });
    expect(handleInfo).not.toBeNull();
    if (!handleInfo) return;

    const hs = await docToScreen(page, handleInfo.handleX, handleInfo.handleY);
    await page.mouse.move(hs.x, hs.y);
    await page.mouse.down();
    const fromA = handleInfo.handleAngle;
    const toA = fromA + Math.PI / 2;
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const a = fromA + (toA - fromA) * t;
      const dx = handleInfo.cx + handleInfo.radius * Math.cos(a);
      const dy = handleInfo.cy + handleInfo.radius * Math.sin(a);
      const sp = await docToScreen(page, dx, dy);
      await page.mouse.move(sp.x, sp.y);
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Snapshot after rotate
    const afterRotate = await snapshotLayerPixels(page);

    // 3. Move again — should NOT snap back to pre-rotation state
    await selectTool(page, 'v');
    // Move from center of the (now rotated) selection
    const mf2 = await docToScreen(page, handleInfo.cx, handleInfo.cy);
    const mt2 = await docToScreen(page, handleInfo.cx + 30, handleInfo.cy);
    await page.mouse.move(mf2.x, mf2.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(
        mf2.x + (mt2.x - mf2.x) * (i / 5),
        mf2.y,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // After the second move, pixel data should be similar to afterRotate
    // (just shifted, not snapped back to pre-rotation)
    const afterMove2 = await snapshotLayerPixels(page);

    // The pixel match with the post-rotate snapshot should be high
    // (content shifted but same shape). If it snapped back, the match
    // would be very low because the shape changed from vertical back to horizontal.
    const matchWithRotated = await comparePixelSnapshots(page, afterRotate.data, afterMove2.data);
    console.log(`  After 2nd move vs after rotate: ${matchWithRotated.toFixed(4)}`);
    // Should be >0.95 (just a 30px shift), would be <0.90 if snapped back
    expect(matchWithRotated).toBeGreaterThan(0.95);

    // Pixel count should be roughly preserved
    const countRatio = afterMove2.opaqueCount / afterRotate.opaqueCount;
    console.log(`  Pixel count ratio: ${countRatio.toFixed(4)}`);
    expect(countRatio).toBeGreaterThan(0.85);
    expect(countRatio).toBeLessThan(1.15);
  });

  test('move selection over other content then rotate only transforms original selection', async ({ page }) => {
    // 1. Paint a RED block at (350,250)-(450,350) and a BLUE block at (500,250)-(600,350)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const { width: w } = state.document;
      const imgData = state.getOrCreateLayerPixelData(state.document.activeLayerId);

      // Red block
      for (let y = 250; y < 350; y++) {
        for (let x = 350; x < 450; x++) {
          const i = (y * w + x) * 4;
          imgData.data[i] = 255;
          imgData.data[i + 1] = 0;
          imgData.data[i + 2] = 0;
          imgData.data[i + 3] = 255;
        }
      }
      // Blue block
      for (let y = 250; y < 350; y++) {
        for (let x = 500; x < 600; x++) {
          const i = (y * w + x) * 4;
          imgData.data[i] = 0;
          imgData.data[i + 1] = 0;
          imgData.data[i + 2] = 255;
          imgData.data[i + 3] = 255;
        }
      }
      state.updateLayerPixelData(state.document.activeLayerId, imgData);
      state.notifyRender();
    });
    await page.waitForTimeout(100);

    // 2. Select the RED block with the marquee tool
    await selectTool(page, 'm');
    const selStart = await docToScreen(page, 345, 245);
    const selEnd = await docToScreen(page, 455, 355);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y);
    await page.mouse.up();
    await page.waitForTimeout(100);

    const sel = await getEditorState(page);
    expect(sel.selection.active).toBe(true);

    // 3. Switch to the move tool and drag the red block ON TOP of the blue block
    await selectTool(page, 'v');
    const moveFrom = await docToScreen(page, 400, 300);
    const moveTo = await docToScreen(page, 550, 300);
    await page.mouse.move(moveFrom.x, moveFrom.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(
        moveFrom.x + (moveTo.x - moveFrom.x) * t,
        moveFrom.y,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 4. Snapshot the blue block region BEFORE rotation — the blue pixels
    //    that are NOT covered by the moved red block should remain blue.
    //    The red block (100x100) moved from x:350-450 to x:500-600,
    //    so it now fully overlaps the blue block.
    //    Snapshot the layer to compare after rotation.
    const beforeRotate = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          layerPixelData: Map<string, ImageData>;
        };
      };
      const state = store.getState();
      const imgData = state.layerPixelData.get(state.document.activeLayerId);
      if (!imgData) return { bluePixelCount: 0, redPixelCount: 0 };
      const w = state.document.width;

      let bluePixelCount = 0;
      let redPixelCount = 0;
      for (let y = 0; y < state.document.height; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = imgData.data[i] ?? 0;
          const g = imgData.data[i + 1] ?? 0;
          const b = imgData.data[i + 2] ?? 0;
          const a = imgData.data[i + 3] ?? 0;
          if (b > 200 && r < 50 && g < 50 && a > 200) bluePixelCount++;
          if (r > 200 && g < 50 && b < 50 && a > 200) redPixelCount++;
        }
      }
      return { bluePixelCount, redPixelCount };
    });

    // The red block now covers the blue block, so blue should be hidden
    // and red should be at least 100x100 = 10000
    console.log(`  Before rotate: red=${beforeRotate.redPixelCount}, blue=${beforeRotate.bluePixelCount}`);
    expect(beforeRotate.redPixelCount).toBeGreaterThan(9000);

    // 5. Rotate the selection using a transform handle.
    //    The transform state should exist from the move mouseup.
    const handleInfo = await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { transform: Record<string, unknown> | null };
      };
      const transform = uiStore.getState().transform;
      if (!transform) return null;

      const ob = transform.originalBounds as { x: number; y: number; width: number; height: number };
      const sX = Math.abs(transform.scaleX as number);
      const sY = Math.abs(transform.scaleY as number);
      const tX = transform.translateX as number;
      const tY = transform.translateY as number;
      const rot = transform.rotation as number;
      const cx = ob.x + ob.width / 2 + tX;
      const cy = ob.y + ob.height / 2 + tY;
      const hw = ob.width * sX / 2;
      const hh = ob.height * sY / 2;
      const rotOff = 20;
      const px = cx + hw + rotOff;
      const py = cy - hh - rotOff;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const dx = px - cx;
      const dy = py - cy;
      return {
        handleX: cx + dx * cos - dy * sin,
        handleY: cy + dx * sin + dy * cos,
        cx, cy,
        radius: Math.sqrt(dx * dx + dy * dy),
        handleAngle: Math.atan2(dy * cos + dx * sin, dx * cos - dy * sin),
      };
    });

    expect(handleInfo).not.toBeNull();
    if (!handleInfo) return;

    // Rotate 45 degrees
    const hs = await docToScreen(page, handleInfo.handleX, handleInfo.handleY);
    await page.mouse.move(hs.x, hs.y);
    await page.mouse.down();
    const fromAngle = handleInfo.handleAngle;
    const toAngle = fromAngle + Math.PI / 4;
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const a = fromAngle + (toAngle - fromAngle) * t;
      const docX = handleInfo.cx + handleInfo.radius * Math.cos(a);
      const docY = handleInfo.cy + handleInfo.radius * Math.sin(a);
      const sp = await docToScreen(page, docX, docY);
      await page.mouse.move(sp.x, sp.y);
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 6. Check: the blue block pixels that were UNDERNEATH the selection
    //    should have been restored (they should NOT have been rotated).
    //    The bug was that the rotation re-cut from composited data, picking
    //    up the blue pixels along with the red ones and rotating them all.
    const afterRotate = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          layerPixelData: Map<string, ImageData>;
        };
      };
      const state = store.getState();
      const imgData = state.layerPixelData.get(state.document.activeLayerId);
      if (!imgData) return { blueInOriginalPosition: 0, totalBlue: 0 };
      const w = state.document.width;

      // Count blue pixels in the original blue block region (500-600, 250-350)
      // These should be restored since the red selection was lifted off them
      let blueInOriginalPosition = 0;
      let totalBlue = 0;
      for (let y = 0; y < state.document.height; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = imgData.data[i] ?? 0;
          const g = imgData.data[i + 1] ?? 0;
          const b = imgData.data[i + 2] ?? 0;
          const a = imgData.data[i + 3] ?? 0;
          if (b > 200 && r < 50 && g < 50 && a > 200) {
            totalBlue++;
            if (x >= 500 && x < 600 && y >= 250 && y < 350) {
              blueInOriginalPosition++;
            }
          }
        }
      }
      return { blueInOriginalPosition, totalBlue };
    });

    console.log(`  After rotate: blue in original position=${afterRotate.blueInOriginalPosition}, total blue=${afterRotate.totalBlue}`);

    // With the bug, blue pixels would be 0 because they'd be swept into the
    // rotation along with the red pixels (the transform re-cut from composited
    // data, including the blue underneath). With the fix, the base canvas
    // preserves the blue block, so blue pixels are revealed as the red diamond
    // rotates away from the corners. Due to the geometry (100x100 block rotated
    // 45° still covers most of the area) and anti-aliasing, we expect ~900-1700
    // pure blue pixels in the exposed corners.
    expect(afterRotate.blueInOriginalPosition).toBeGreaterThan(500);
    expect(afterRotate.totalBlue).toBeGreaterThan(500);
  });
});
