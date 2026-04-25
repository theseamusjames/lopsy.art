import { test, type Page } from './fixtures';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, w: number, h: number, transparent: boolean) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w, h, t: transparent },
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

async function paintRectOnActiveLayer(page: Page, x: number, y: number, w: number, h: number) {
  // Paint directly into JS pixel data, then upload to GPU.
  await page.evaluate(
    ({ x, y, w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; width: number; height: number }> };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const s = store.getState();
      const id = s.document.activeLayerId;
      const data = s.getOrCreateLayerPixelData(id);
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          if (px < 0 || px >= data.width || py < 0 || py >= data.height) continue;
          const idx = (py * data.width + px) * 4;
          data.data[idx] = 0;
          data.data[idx + 1] = 0;
          data.data[idx + 2] = 0;
          data.data[idx + 3] = 255;
        }
      }
      s.updateLayerPixelData(id, data);
    },
    { x, y, w, h },
  );
  await page.waitForTimeout(200);
}

async function selectMoveTool(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('move');
  });
  await page.waitForTimeout(100);
}

async function getLayerPos(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> };
      };
    };
    const s = store.getState();
    const l = s.document.layers.find((l) => l.id === s.document.activeLayerId);
    return l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null;
  });
}

async function clickAlign(page: Page, label: string) {
  const btn = page.locator(`button[aria-label="${label}"]`);
  await btn.click();
  await page.waitForTimeout(250);
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

async function paintRectWithBrush(page: Page, docX: number, docY: number, w: number, h: number) {
  // Draw a filled rect with brush by painting parallel horizontal strokes.
  await page.keyboard.press('b');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setBrushSize: (v: number) => void;
        setBrushHardness: (v: number) => void;
        setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
      };
    };
    store.getState().setBrushSize(8);
    store.getState().setBrushHardness(100);
    store.getState().setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
  });
  for (let yy = docY; yy <= docY + h; yy += 4) {
    const s = await docToScreen(page, docX, yy);
    const e = await docToScreen(page, docX + w, yy);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(e.x, e.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(200);
}

test.describe('Align buttons sequence — 50x100 rect at (50,50) on 1920x1080', () => {
  test('press each align button, screenshot between', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1920, 1080, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Paint a 50x100 black rect at (50,50) on Layer 1 (active)
    await paintRectOnActiveLayer(page, 50, 50, 50, 100);

    await selectMoveTool(page);

    const initial = await getLayerPos(page);
    console.log('initial layer pos:', initial);
    await page.screenshot({ path: 'test-results/align-sequence/00-initial.png', fullPage: false });

    const buttons: Array<[string, string]> = [
      ['left', 'Align left'],
      ['center-h', 'Align center horizontally'],
      ['right', 'Align right'],
      ['top', 'Align top'],
      ['center-v', 'Align center vertically'],
      ['bottom', 'Align bottom'],
    ];

    let step = 1;
    for (const [edge, label] of buttons) {
      await clickAlign(page, label);
      const pos = await getLayerPos(page);
      console.log(`step ${step} (${edge}) layer pos:`, pos);
      const stepStr = String(step).padStart(2, '0');
      await page.screenshot({ path: `test-results/align-sequence/${stepStr}-${edge}.png`, fullPage: false });
      step++;
    }

    // Second pass — see if behavior changes on repeat
    for (const [edge, label] of buttons) {
      await clickAlign(page, label);
      const pos = await getLayerPos(page);
      console.log(`step ${step} (${edge} REPEAT) layer pos:`, pos);
      const stepStr = String(step).padStart(2, '0');
      await page.screenshot({ path: `test-results/align-sequence/${stepStr}-${edge}-repeat.png`, fullPage: false });
      step++;
    }
  });

  test('BRUSH-DRAWN rect: press each align button, screenshot between', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1920, 1080, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Draw a 50x100 filled rect at (50,50) using the BRUSH tool (matches real workflow)
    await paintRectWithBrush(page, 50, 50, 50, 100);

    await selectMoveTool(page);

    const initial = await getLayerPos(page);
    console.log('[brush] initial layer pos:', initial);
    await page.screenshot({ path: 'test-results/align-sequence/brush-00-initial.png' });

    const buttons: Array<[string, string]> = [
      ['left', 'Align left'],
      ['center-h', 'Align center horizontally'],
      ['right', 'Align right'],
      ['top', 'Align top'],
      ['center-v', 'Align center vertically'],
      ['bottom', 'Align bottom'],
    ];

    let step = 1;
    for (const [edge, label] of buttons) {
      await clickAlign(page, label);
      const pos = await getLayerPos(page);
      console.log(`[brush] step ${step} (${edge}) layer pos:`, pos);
      const stepStr = String(step).padStart(2, '0');
      await page.screenshot({ path: `test-results/align-sequence/brush-${stepStr}-${edge}.png` });
      step++;
    }

    for (const [edge, label] of buttons) {
      await clickAlign(page, label);
      const pos = await getLayerPos(page);
      console.log(`[brush] step ${step} (${edge} REPEAT) layer pos:`, pos);
      const stepStr = String(step).padStart(2, '0');
      await page.screenshot({ path: `test-results/align-sequence/brush-${stepStr}-${edge}-repeat.png` });
      step++;
    }
  });
});
