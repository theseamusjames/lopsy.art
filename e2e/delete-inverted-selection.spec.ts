/**
 * Regression test: pressing Delete with an inverted selection on a
 * duplicate-moved layer used to produce garbled pixel output because
 * clipboard_clear_selected rendered into a doc-sized scratch texture
 * but blitted back with UVs spanning the full (larger) texture.
 */
import { test, expect, type Page } from './fixtures';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
  );
}

async function createDocument(page: Page, width: number, height: number) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
  );
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
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        cx;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function getPixelAt(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(
    async ({ x, y, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string;
            layers: Array<{ id: string; x: number; y: number }>;
          };
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      const layer = state.document.layers.find((l) => l.id === id);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(id);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const localX = x - lx;
      const localY = y - ly;
      if (localX < 0 || localX >= result.width || localY < 0 || localY >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const idx = (localY * result.width + localX) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { x, y, lid: layerId ?? null },
  );
}

async function getLayers(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          layers: Array<{ id: string; name: string; x: number; y: number }>;
          activeLayerId: string;
        };
      };
    };
    const s = store.getState();
    return {
      layers: s.document.layers.map((l) => ({ id: l.id, name: l.name, x: l.x, y: l.y })),
      activeLayerId: s.document.activeLayerId,
    };
  });
}

test('delete with inverted selection clears only the correct region', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 400);

  // Activate shape tool — ellipse mode, black fill, pixel output
  await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setShapeMode: (m: string) => void;
        setShapeFillColor: (c: { r: number; g: number; b: number; a: number }) => void;
        setShapeOutput: (o: string) => void;
      };
    };
    ui.getState().setActiveTool('shape');
    ts.getState().setShapeMode('ellipse');
    ts.getState().setShapeFillColor({ r: 0, g: 0, b: 0, a: 1 });
    ts.getState().setShapeOutput('pixels');
  });
  await page.waitForTimeout(100);

  // Draw circle: bounding box (100,100)→(300,300) — center (200,200), r≈100
  const drawStart = await docToScreen(page, 100, 100);
  const drawEnd = await docToScreen(page, 300, 300);
  await page.mouse.move(drawStart.x, drawStart.y);
  await page.mouse.down();
  await page.mouse.move(drawEnd.x, drawEnd.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Switch to move tool, alt-drag 50px right to duplicate layer
  await page.keyboard.press('v');
  await page.waitForTimeout(100);

  const moveStart = await docToScreen(page, 200, 200);
  const moveEnd = await docToScreen(page, 250, 200);
  await page.keyboard.down('Alt');
  await page.mouse.move(moveStart.x, moveStart.y);
  await page.mouse.down();
  await page.mouse.move(moveEnd.x, moveEnd.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(500);

  // Verify duplicate was created
  const info = await getLayers(page);
  const originalLayer = info.layers.find((l) => l.name === 'Layer 1');
  const copyLayer = info.layers.find((l) => l.name === 'Layer 1 copy');
  expect(originalLayer).toBeTruthy();
  expect(copyLayer).toBeTruthy();

  // Cmd-click original layer's thumbnail to create selection from its alpha
  const layer1Row = page
    .locator('[class*="itemWrapper"]')
    .filter({ has: page.getByText('Layer 1', { exact: true }) });
  const thumbnail = layer1Row.locator('div[class*="thumbnail"]');
  await thumbnail.click({ modifiers: [isMac ? 'Meta' : 'Control'] });
  await page.waitForTimeout(300);

  // Selection should be active
  const selActive = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean } };
    };
    return store.getState().selection.active;
  });
  expect(selActive).toBe(true);

  // Invert the selection
  await page.keyboard.press(`Shift+${mod}+i`);
  await page.waitForTimeout(200);

  // Make copy layer active (click its name in the layers panel)
  const copyRow = page
    .locator('[class*="itemWrapper"]')
    .filter({ has: page.getByText('Layer 1 copy', { exact: true }) });
  await copyRow.locator('[class*="name"]').click();
  await page.waitForTimeout(200);

  // Confirm copy layer is now active
  const activeId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
  expect(activeId).toBe(copyLayer!.id);

  await page.screenshot({ path: 'e2e/screenshots/delete-inverted-selection-before.png' });

  // Press Backspace to delete selected region
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'e2e/screenshots/delete-inverted-selection-after.png' });

  // The copy circle was centred at ~(250,200) r≈100.
  // The selection was inverted from Layer 1's circle at ~(200,200) r≈100.
  // Delete clears pixels INSIDE the inverted selection (outside original circle).
  // So only the overlap (lens-shaped intersection) should remain on the copy.
  //
  // Probe 1: (225,200) is inside both circles → should survive delete.
  // Probe 2: (320,200) is inside copy circle but outside original → should be cleared.
  const overlap = await getPixelAt(page, 225, 200, copyLayer!.id);
  expect(overlap.a).toBeGreaterThan(0);

  const cleared = await getPixelAt(page, 320, 200, copyLayer!.id);
  expect(cleared.a).toBe(0);
});
