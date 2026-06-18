import { test, expect, type Page } from './fixtures';
import { setToolOption, setBrushModalOption, openBrushModal, closeBrushModal } from './helpers';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 600, height = 300) {
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
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + rect.width / 2,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + rect.height / 2,
      };
    },
    { docX, docY },
  );
}

async function countPaintedPixels(page: Page, y: number, xStart: number, xEnd: number): Promise<number> {
  return page.evaluate(
    async ({ y, xStart, xEnd }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn();
      if (!result) return 0;
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      if (!container) return 0;
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      let count = 0;
      for (let docX = xStart; docX <= xEnd; docX++) {
        const screenX = Math.round((docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx);
        const screenY = Math.round((y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy);
        const px = screenX;
        const py = result.height - 1 - screenY;
        if (px < 0 || px >= result.width || py < 0 || py >= result.height) continue;
        const idx = (py * result.width + px) * 4;
        const r = result.pixels[idx] ?? 255;
        const g = result.pixels[idx + 1] ?? 255;
        if (r < 200 || g < 200) count++;
      }
      return count;
    },
    { y, xStart, xEnd },
  );
}

function selectBrushTab(page: Page, tabName: string) {
  return openBrushModal(page).then(() =>
    page.locator(`[role="dialog"][aria-label="Brushes"] [role="option"]:has-text("${tabName}")`).click()
  ).then(() => page.waitForTimeout(50));
}

test('shift-click taper density matches drag taper density (round brush)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 300);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(500);

  // Select brush, set up with spacing and taper
  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await setToolOption(page, 'Size', 30);
  await setToolOption(page, 'Opacity', 100);
  await setToolOption(page, 'Hardness', 100);

  await selectBrushTab(page, 'Shape');
  await setBrushModalOption(page, 'Spacing', 80);
  await setBrushModalOption(page, 'Taper', 400);
  await closeBrushModal(page);

  await page.evaluate(() => {
    const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void };
    };
    ts.getState().setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
  });

  // Drag stroke at y=80
  const dragStart = await docToScreen(page, 50, 80);
  const dragEnd = await docToScreen(page, 550, 80);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const dragPixels = await countPaintedPixels(page, 80, 50, 550);

  // Undo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  // Shift-click stroke at y=80: click at start, shift-click at end
  const shiftStart = await docToScreen(page, 50, 80);
  const shiftEnd = await docToScreen(page, 550, 80);
  await page.mouse.click(shiftStart.x, shiftStart.y);
  await page.waitForTimeout(200);
  await page.keyboard.down('Shift');
  await page.mouse.click(shiftEnd.x, shiftEnd.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);

  const shiftPixels = await countPaintedPixels(page, 80, 50, 550);

  await page.screenshot({ path: 'e2e/screenshots/brush-taper-shift-comparison.png' });

  console.log(`Taper density — drag pixels: ${dragPixels}, shift pixels: ${shiftPixels}`);
  console.log(`Ratio: ${(shiftPixels / dragPixels).toFixed(2)}`);

  // Shift-click should have at least 60% of the painted pixels of the drag.
  // If taper spacing is working correctly, both should be similar.
  expect(shiftPixels).toBeGreaterThan(dragPixels * 0.6);
});

test('shift-click taper density matches drag with custom bitmap tip', async ({ page, isMobile }) => {
  test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 300);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(1000);

  // Select the Star bitmap preset (loaded async after WASM init)
  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        presets: Array<{ id: string; name: string }>;
        setActivePreset: (id: string) => void;
        setBrushSize: (s: number) => void;
        setBrushTaper: (t: number) => void;
        setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
      };
    };
    const s = ts.getState();
    const star = s.presets.find((p) => p.name === 'Star');
    if (star) s.setActivePreset(star.id);
    s.setBrushSize(30);
    s.setBrushTaper(400);
    // Star preset has scatter=0, but test with scatter to cover that path
    (s as unknown as { setBrushScatter: (v: number) => void }).setBrushScatter(20);
    s.setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
  });
  await page.waitForTimeout(200);

  // Drag stroke at y=80
  const dragStart = await docToScreen(page, 50, 80);
  const dragEnd = await docToScreen(page, 550, 80);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const dragPixels = await countPaintedPixels(page, 80, 50, 550);

  // Undo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  // Shift-click
  const shiftStart = await docToScreen(page, 50, 80);
  const shiftEnd = await docToScreen(page, 550, 80);
  await page.mouse.click(shiftStart.x, shiftStart.y);
  await page.waitForTimeout(200);
  await page.keyboard.down('Shift');
  await page.mouse.click(shiftEnd.x, shiftEnd.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);

  const shiftPixels = await countPaintedPixels(page, 80, 50, 550);

  await page.screenshot({ path: 'e2e/screenshots/brush-taper-shift-star.png' });

  // Also count distinct dabs by counting painted→unpainted transitions
  const countDabs = async (y: number) => {
    return page.evaluate(
      async ({ y, xStart, xEnd }) => {
        const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
          () => Promise<{ width: number; height: number; pixels: number[] } | null>;
        const result = await readFn();
        if (!result) return 0;
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { width: number; height: number };
            viewport: { zoom: number; panX: number; panY: number };
          };
        };
        const state = store.getState();
        const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
        if (!container) return 0;
        const rect = container.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        let transitions = 0;
        let wasPainted = false;
        for (let docX = xStart; docX <= xEnd; docX++) {
          const screenX = Math.round((docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx);
          const screenY = Math.round((y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy);
          const px = screenX;
          const py = result.height - 1 - screenY;
          let isPainted = false;
          if (px >= 0 && px < result.width && py >= 0 && py < result.height) {
            const idx = (py * result.width + px) * 4;
            isPainted = (result.pixels[idx] ?? 255) < 200;
          }
          if (isPainted && !wasPainted) transitions++;
          wasPainted = isPainted;
        }
        return transitions;
      },
      { y, xStart: 50, xEnd: 550 },
    );
  };

  // Undo shift-click, redo drag for dab counting
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  // Redraw drag
  const dragStart2 = await docToScreen(page, 50, 80);
  const dragEnd2 = await docToScreen(page, 550, 80);
  await page.mouse.move(dragStart2.x, dragStart2.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd2.x, dragEnd2.y, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const dragDabs = await countDabs(80);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  // Redraw shift-click
  const ss2 = await docToScreen(page, 50, 80);
  const se2 = await docToScreen(page, 550, 80);
  await page.mouse.click(ss2.x, ss2.y);
  await page.waitForTimeout(200);
  await page.keyboard.down('Shift');
  await page.mouse.click(se2.x, se2.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  const shiftDabs = await countDabs(80);

  console.log(`Star taper — drag pixels: ${dragPixels}, shift pixels: ${shiftPixels}`);
  console.log(`Star taper dab count — drag: ${dragDabs}, shift: ${shiftDabs}`);
  console.log(`Pixel ratio: ${dragPixels > 0 ? (shiftPixels / dragPixels).toFixed(2) : 'N/A'}, Dab ratio: ${dragDabs > 0 ? (shiftDabs / dragDabs).toFixed(2) : 'N/A'}`);

  expect(shiftPixels).toBeGreaterThan(dragPixels * 0.6);
  expect(shiftDabs).toBeGreaterThan(dragDabs * 0.6);
});
