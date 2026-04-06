import { test, expect, type Page } from '@playwright/test';
import { createDocument, getEditorState, paintRect } from './helpers';

const isMac = process.platform === 'darwin';

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

/** Count opaque pixels on the active layer only (GPU readback) */
async function countActiveLayerPixelsGPU(page: Page) {
  return page.evaluate(() => {
    const engineState = (window as unknown as Record<string, unknown>).__engineState as {
      getEngine: () => unknown;
    } | undefined;
    const bridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
      render: (engine: unknown) => void;
      readLayerPixels: (engine: unknown, layerId: string) => Uint8Array;
      getLayerTextureDimensions: (engine: unknown, layerId: string) => Uint32Array | null;
    } | undefined;
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    } | undefined;
    if (!engineState || !bridge || !store) return -1;

    const engine = engineState.getEngine();
    if (!engine) return -1;

    bridge.render(engine);
    const layerId = store.getState().document.activeLayerId;
    const dims = bridge.getLayerTextureDimensions(engine, layerId);
    if (!dims || dims[0] === 0 || dims[1] === 0) return 0;

    const pixels = bridge.readLayerPixels(engine, layerId);
    let count = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]! > 0) count++;
    }
    return count;
  });
}

async function cmdClickThumbnail(page: Page) {
  const thumbnail = page.locator('[class*="thumbnail"]').first();
  await thumbnail.click({ modifiers: [isMac ? 'Meta' : 'Control'] });
  await page.waitForTimeout(300);
}

async function assertSelectionActive(page: Page) {
  const active = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean } };
    };
    return store.getState().selection.active;
  });
  expect(active).toBe(true);
}

/** Get transform handle info for dragging */
async function getScaleHandleInfo(page: Page, handle: string) {
  return page.evaluate((handleName) => {
    const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: Record<string, unknown> | null };
    };
    const transform = uiStore.getState().transform;
    if (!transform) return null;

    // Use the actual getHandlePositions from the transform module
    const ob = transform.originalBounds as { x: number; y: number; width: number; height: number };
    const scaleX = transform.scaleX as number;
    const scaleY = transform.scaleY as number;
    const translateX = transform.translateX as number;
    const translateY = transform.translateY as number;
    const rot = transform.rotation as number;
    const skewX = transform.skewX as number;
    const skewY = transform.skewY as number;

    const origCx = ob.x + ob.width / 2;
    const origCy = ob.y + ob.height / 2;
    const tanSkewX = Math.tan(skewX);
    const tanSkewY = Math.tan(skewY);

    function transformPt(px: number, py: number) {
      let x = px - origCx;
      let y = py - origCy;
      const sx = x + y * tanSkewX;
      const sy = x * tanSkewY + y;
      x = sx * scaleX;
      y = sy * scaleY;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      return {
        x: x * cos - y * sin + origCx + translateX,
        y: x * sin + y * cos + origCy + translateY,
      };
    }

    const left = ob.x;
    const right = ob.x + ob.width;
    const top = ob.y;
    const bottom = ob.y + ob.height;
    const midX = ob.x + ob.width / 2;
    const midY = ob.y + ob.height / 2;

    const handleMap: Record<string, { x: number; y: number }> = {
      'top-left': transformPt(left, top),
      'top': transformPt(midX, top),
      'top-right': transformPt(right, top),
      'right': transformPt(right, midY),
      'bottom-right': transformPt(right, bottom),
      'bottom': transformPt(midX, bottom),
      'bottom-left': transformPt(left, bottom),
      'left': transformPt(left, midY),
    };

    return handleMap[handleName] ?? null;
  }, handle);
}

/** Get rotation handle info for rotating */
async function getRotationHandleInfo(page: Page) {
  return page.evaluate(() => {
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
      currentAngle: Math.atan2(
        (cx + dx * cos - dy * sin) - cx,
        -((cy + dx * sin + dy * cos) - cy),
      ),
    };
  });
}

/** Drag a rotation handle by a given angle in radians */
async function dragRotate(page: Page, angleRadians: number) {
  const info = await getRotationHandleInfo(page);
  if (!info) throw new Error('No transform state for rotation');

  const handleScreen = await docToScreen(page, info.handleX, info.handleY);
  await page.mouse.move(handleScreen.x, handleScreen.y);
  await page.mouse.down();

  const startAngle = Math.atan2(info.handleY - info.cy, info.handleX - info.cx);
  const endAngle = startAngle + angleRadians;
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const angle = startAngle + (endAngle - startAngle) * t;
    const docX = info.cx + info.radius * Math.cos(angle);
    const docY = info.cy + info.radius * Math.sin(angle);
    const screenPt = await docToScreen(page, docX, docY);
    await page.mouse.move(screenPt.x, screenPt.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Drag a scale handle to a new doc position */
async function dragScaleHandle(page: Page, handle: string, toDocX: number, toDocY: number) {
  const pos = await getScaleHandleInfo(page, handle);
  if (!pos) throw new Error(`No handle position for ${handle}`);

  const start = await docToScreen(page, pos.x, pos.y);
  const end = await docToScreen(page, toDocX, toDocY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Move selected content via the move tool */
async function moveViaMouse(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
  const start = await docToScreen(page, fromX, fromY);
  const end = await docToScreen(page, toX, toY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Click the Rotate 90° CW button in the options bar */
async function clickRotate90CW(page: Page) {
  const btn = page.locator('button[aria-label="Rotate 90° CW"]');
  await btn.click();
  await page.waitForTimeout(300);
}

/** Click the Flip Horizontal button in the options bar */
async function clickFlipHorizontal(page: Page) {
  const btn = page.locator('button[aria-label="Flip Horizontal"]');
  await btn.click();
  await page.waitForTimeout(300);
}

/** Enable snap to grid */
async function enableGrid(page: Page) {
  await page.evaluate(() => {
    const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { showGrid: boolean; toggleGrid: () => void };
    };
    const state = uiStore.getState();
    if (!state.showGrid) state.toggleGrid();
  });
  await page.waitForTimeout(100);
}

/** Disable grid */
async function disableGrid(page: Page) {
  await page.evaluate(() => {
    const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { showGrid: boolean; toggleGrid: () => void };
    };
    const state = uiStore.getState();
    if (state.showGrid) state.toggleGrid();
  });
  await page.waitForTimeout(100);
}

test.describe('Transform stray pixels (UI interactions)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  });

  test('select → move via UI → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 400, 400, false);
    const state = await getEditorState(page);
    await paintRect(page, 100, 100, 200, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);
    expect(await countActiveLayerPixelsGPU(page)).toBe(40000);

    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await moveViaMouse(page, 200, 200, 300, 100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → rotate 90° button → re-select → move → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 400, 400, false);
    const state = await getEditorState(page);
    // Non-square rect so rotation visibly changes shape
    await paintRect(page, 100, 150, 200, 100, { r: 255, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    // Select and rotate via UI button
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Need to be on move tool to see TransformControls
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    await clickRotate90CW(page);

    // Re-select from new shape
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Move
    await moveViaMouse(page, 200, 200, 300, 100);

    // Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → drag rotate handle 45° → commit → re-select → move → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 600, 600, false);
    const state = await getEditorState(page);
    await paintRect(page, 200, 200, 200, 200, { r: 0, g: 0, b: 255, a: 255 }, state.document.activeLayerId);

    // Select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Drag rotation handle ~45°
    await dragRotate(page, Math.PI / 4);

    // Commit transform by pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select from rotated alpha
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Move
    await moveViaMouse(page, 300, 300, 400, 200);

    // Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → drag resize handle → commit → re-select → move → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 600, 600, false);
    const state = await getEditorState(page);
    await paintRect(page, 200, 200, 150, 150, { r: 0, g: 128, b: 0, a: 255 }, state.document.activeLayerId);

    // Select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Drag bottom-right handle to scale up
    await dragScaleHandle(page, 'bottom-right', 450, 450);

    // Commit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Move
    await moveViaMouse(page, 300, 300, 400, 200);

    // Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → rotate 90° button → drag resize → commit → re-select → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 600, 600, false);
    const state = await getEditorState(page);
    await paintRect(page, 200, 200, 200, 100, { r: 128, g: 0, b: 128, a: 255 }, state.document.activeLayerId);

    // Select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(100);

    // Rotate 90° via button (GPU: float → flip → drop → rebuild mask)
    await clickRotate90CW(page);
    await page.waitForTimeout(200);

    // Verify content still exists
    const afterRotate = await countActiveLayerPixelsGPU(page);
    expect(afterRotate).toBeGreaterThan(0);

    // Re-select to update mask after rotation
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Resize via handle
    await dragScaleHandle(page, 'bottom-right', 450, 500);

    // Commit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select and delete
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → flip → move → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 400, 400, false);
    const state = await getEditorState(page);
    await paintRect(page, 100, 100, 150, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    await clickFlipHorizontal(page);

    // Move
    await moveViaMouse(page, 175, 200, 250, 150);

    // Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);
    const count1 = await countActiveLayerPixelsGPU(page);

    // Clear selection to drop any remaining state
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const count2 = await countActiveLayerPixelsGPU(page);

    expect(count1).toBe(0);
    expect(count2).toBe(0);
  });

  test('select → move → commit → flip → re-select → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 400, 400, false);
    const state = await getEditorState(page);
    await paintRect(page, 100, 100, 150, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Move
    await moveViaMouse(page, 175, 200, 250, 150);

    // Commit the move (Escape drops the float + clears selection)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Re-select, then flip
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    await clickFlipHorizontal(page);
    await page.waitForTimeout(200);

    // Re-select and delete
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → flip → move → commit → re-select → flip → re-select → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 400, 400, false);
    const state = await getEditorState(page);
    await paintRect(page, 100, 100, 150, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    // Select, flip horizontal
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    await clickFlipHorizontal(page);
    await page.waitForTimeout(200);

    // Move
    await moveViaMouse(page, 175, 200, 250, 150);

    // Commit move
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Re-select, flip vertical
    await cmdClickThumbnail(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    const flipVBtn = page.locator('button[aria-label="Flip Vertical"]');
    await flipVBtn.click();
    await page.waitForTimeout(200);

    // Re-select and delete
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → drag rotate with snap → commit → re-select → move → delete → canvas empty', async ({ page }) => {
    await createDocument(page, 600, 600, false);
    const state = await getEditorState(page);
    await paintRect(page, 200, 200, 200, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    // Select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Enable grid (which enables snap)
    await enableGrid(page);

    // Drag rotate — should snap to 15° increments (45° = 3 snaps)
    await dragRotate(page, Math.PI / 4);

    // Disable grid
    await disableGrid(page);

    // Commit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Move
    await moveViaMouse(page, 300, 300, 400, 200);

    // Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → drag rotate 45° → re-select → drag resize (no commit between) → commit → re-select → delete → canvas empty', async ({ page }) => {
    // User's exact repro: rotate then immediately resize without committing
    await createDocument(page, 600, 600, false);
    const state = await getEditorState(page);
    await paintRect(page, 200, 200, 200, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    // Select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Rotate 45° via handle drag
    await dragRotate(page, Math.PI / 4);

    // Re-select (cmd+click) to reshape marquee — should commit rotation
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Immediately drag resize handle (no Escape between)
    await dragScaleHandle(page, 'bottom-right', 450, 450);

    // Commit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select and delete
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → rotate with snap → re-select → resize → move → delete → canvas empty', async ({ page }) => {
    // User's full repro: rotate with grid, re-select, resize, then move
    await createDocument(page, 600, 600, false);
    const state = await getEditorState(page);
    await paintRect(page, 200, 200, 200, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    // Select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Enable grid, rotate (snaps to 45°)
    await enableGrid(page);
    await dragRotate(page, Math.PI / 4);
    await disableGrid(page);

    // Re-select to reshape marquee
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Resize
    await dragScaleHandle(page, 'bottom-right', 450, 450);

    // Commit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select and move
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await moveViaMouse(page, 300, 300, 400, 200);

    // Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('select → drag rotate → move → drag rotate again → commit → re-select → delete → canvas empty', async ({ page }) => {
    // Chained: rotate, move, rotate again
    await createDocument(page, 600, 600, false);
    const state = await getEditorState(page);
    await paintRect(page, 200, 200, 200, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    // Select
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);

    // Rotate 30°
    await dragRotate(page, Math.PI / 6);

    // Commit first rotation
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select and move
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await moveViaMouse(page, 300, 300, 350, 250);

    // Commit move
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select and rotate again
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await dragRotate(page, Math.PI / 6);

    // Commit second rotation
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select and delete
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    expect(await countActiveLayerPixelsGPU(page)).toBe(0);
  });

  test('no stray pixels visible after rotate and deselect (GPU composite check)', async ({ page }) => {
    // Specific test for marching ants artifacts: rotate then deselect, check edges
    await createDocument(page, 400, 400, false);
    const state = await getEditorState(page);
    await paintRect(page, 100, 100, 200, 200, { r: 0, g: 0, b: 0, a: 255 }, state.document.activeLayerId);

    const beforePixels = await countActiveLayerPixelsGPU(page);
    expect(beforePixels).toBe(200 * 200);

    // Select, rotate 45°, commit
    await cmdClickThumbnail(page);
    await assertSelectionActive(page);
    await dragRotate(page, Math.PI / 4);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // After rotate+deselect, pixel count should be close to original
    // (GPU bilinear filtering may change count slightly but shouldn't add stray pixels)
    const afterPixels = await countActiveLayerPixelsGPU(page);
    // Rotated content covers slightly different area due to anti-aliasing,
    // but should be within reasonable range (no massive stray artifacts)
    expect(afterPixels).toBeGreaterThan(beforePixels * 0.85);
    expect(afterPixels).toBeLessThan(beforePixels * 1.15);
  });
});
