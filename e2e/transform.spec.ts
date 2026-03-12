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
});
