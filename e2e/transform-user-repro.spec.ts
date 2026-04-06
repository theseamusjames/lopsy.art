/**
 * Exact reproduction of the user's reported bugs.
 * Uses the actual shape tool, actual UI interactions, and GPU pixel readback.
 */
import { test, expect, type Page } from '@playwright/test';

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

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(
    ({ setter, value }) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => Record<string, (v: unknown) => void>;
      };
      store.getState()[setter]!(value);
    },
    { setter, value },
  );
}

/** Count opaque pixels on the active layer only (not the full composite) */
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

async function drawShape(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const start = await docToScreen(page, fromX, fromY);
  const end = await docToScreen(page, toX, toY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function cmdClickThumbnail(page: Page) {
  const thumbnail = page.locator('[class*="thumbnail"]').first();
  await thumbnail.click({ modifiers: [isMac ? 'Meta' : 'Control'] });
  await page.waitForTimeout(300);
}

async function dragRotate(page: Page, angleRadians: number) {
  const info = await page.evaluate(() => {
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
    };
  });
  if (!info) throw new Error('No transform state');

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
  await page.waitForTimeout(300);
}

test.describe('User repro: shape tool + transform', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    // Create 600x600 doc with white background (matches default editor setup)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(600, 600, false);
    });
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(200);
  });

  test('shape tool polygon → cmd+click select → rotate 45° → commit → should have content', async ({ page }) => {
    // Draw a 200x200 polygon (4 sides = diamond)
    await page.keyboard.press('u'); // Shape tool
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw from center outward
    await drawShape(page, 300, 300, 400, 400);

    // Verify shape was drawn
    const shapePixels = await countActiveLayerPixelsGPU(page);
    console.log('After shape:', shapePixels);
    expect(shapePixels).toBeGreaterThan(1000);

    // Cmd+click to select content
    await cmdClickThumbnail(page);
    await page.waitForTimeout(200);

    // Verify selection active
    const selActive = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection.active;
    });
    expect(selActive).toBe(true);

    // Rotate 45°
    await dragRotate(page, Math.PI / 4);

    // Check content still exists after rotation (not lost)
    const afterRotate = await countActiveLayerPixelsGPU(page);
    console.log('After rotate:', afterRotate);
    expect(afterRotate).toBeGreaterThan(shapePixels * 0.5);

    // Commit (Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Content should still be there after commit
    const afterCommit = await countActiveLayerPixelsGPU(page);
    console.log('After commit:', afterCommit);
    expect(afterCommit).toBeGreaterThan(shapePixels * 0.5);
  });

  test('shape tool polygon → select → rotate → re-select → move → delete → canvas empty', async ({ page }) => {
    // Draw diamond
    await page.keyboard.press('u');
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);
    await drawShape(page, 300, 300, 400, 400);

    const shapePixels = await countActiveLayerPixelsGPU(page);
    expect(shapePixels).toBeGreaterThan(1000);

    // Select, rotate, commit
    await cmdClickThumbnail(page);
    await dragRotate(page, Math.PI / 4);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Re-select the rotated content
    await cmdClickThumbnail(page);

    // Move
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    const start = await docToScreen(page, 300, 300);
    const end = await docToScreen(page, 400, 200);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    // Should be empty
    const finalPixels = await countActiveLayerPixelsGPU(page);
    console.log('Final pixels:', finalPixels);
    expect(finalPixels).toBe(0);
  });

  test('select → rotate → move immediately (no commit) → delete → canvas empty', async ({ page }) => {
    // User's repro: rotate then move without pressing Escape first
    await page.keyboard.press('u');
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);
    await drawShape(page, 300, 300, 400, 400);

    const shapePixels = await countActiveLayerPixelsGPU(page);
    expect(shapePixels).toBeGreaterThan(1000);

    // Select
    await cmdClickThumbnail(page);

    // Rotate 45° via handle drag
    await dragRotate(page, Math.PI / 4);

    // Immediately move (no Escape, no re-select)
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    const start = await docToScreen(page, 300, 300);
    const end = await docToScreen(page, 400, 200);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    const finalPixels = await countActiveLayerPixelsGPU(page);
    console.log('Rotate→move (no commit) final pixels:', finalPixels);
    expect(finalPixels).toBe(0);
  });
});
