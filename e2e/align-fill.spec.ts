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
  await page.waitForTimeout(200);
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

async function drawSpiral(page: Page, cx: number, cy: number, maxR: number) {
  const a = maxR / (Math.PI * 6);
  const pts: Array<{ x: number; y: number }> = [];
  for (let theta = 0; theta < Math.PI * 6; theta += 0.15) {
    const r = a * theta;
    pts.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  const first = await docToScreen(page, pts[0]!.x, pts[0]!.y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const p = await docToScreen(page, pts[i]!.x, pts[i]!.y);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('align bottom, then fill center — spiral stays visible', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 1920, 1080, true);
  await page.waitForSelector('[data-testid="canvas-container"]');

  // Set brush: black, size 6
  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setBrushSize: (v: number) => void;
        setBrushHardness: (v: number) => void;
        setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
      };
    };
    store.getState().setBrushSize(6);
    store.getState().setBrushHardness(100);
    store.getState().setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
  });
  await drawSpiral(page, 150, 150, 80);
  await page.screenshot({ path: 'test-results/align-fill/01-spiral.png' });

  // Align bottom
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('move');
  });
  await page.waitForTimeout(100);
  await page.locator(`button[aria-label="Align bottom"]`).click();
  await page.waitForTimeout(400);

  const afterAlign = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } };
    };
    const s = store.getState();
    return s.document.layers.find((l) => l.id === s.document.activeLayerId);
  });
  console.log('after align bottom x=', afterAlign?.x, 'y=', afterAlign?.y, 'w=', afterAlign?.width, 'h=', afterAlign?.height);

  // Probe texture dims AFTER align, before changing tool
  const dimsAfterAlign = await page.evaluate(async () => {
    const read = (window as unknown as {
      __readLayerPixels?: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    }).__readLayerPixels;
    if (!read) return null;
    const p = await read();
    return p ? { w: p.width, h: p.height } : null;
  });
  console.log('texture dims AFTER align:', dimsAfterAlign);
  await page.screenshot({ path: 'test-results/align-fill/02-align-bottom.png' });

  // Select red as foreground color
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
      };
    };
    store.getState().setForegroundColor({ r: 255, g: 0, b: 0, a: 1 });
  });

  // Select fill (bucket) tool
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('fill');
  });
  await page.waitForTimeout(100);

  // Probe texture dims BEFORE fill
  const dimsBefore = await page.evaluate(async () => {
    const read = (window as unknown as {
      __readLayerPixels?: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    }).__readLayerPixels;
    if (!read) return null;
    const p = await read();
    return p ? { w: p.width, h: p.height } : null;
  });
  console.log('texture dims BEFORE fill:', dimsBefore);

  // Click center of the canvas (doc 960, 540)
  const center = await docToScreen(page, 960, 540);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'test-results/align-fill/03-after-fill.png' });

  // Read LAYER TEXTURE to see if the spiral survived the fill
  const texProbe = await page.evaluate(async () => {
    const read = (window as unknown as {
      __readLayerPixels?: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    }).__readLayerPixels;
    if (!read) return null;
    const p = await read();
    if (!p || p.width === 0) return p;
    const w = p.width, h = p.height;
    const data = p.pixels;
    let black = 0, red = 0, transparent = 0, other = 0;
    let blackBbox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = data[i] ?? 0, g = data[i+1] ?? 0, b = data[i+2] ?? 0, a = data[i+3] ?? 0;
        if (a < 20) transparent++;
        else if (r < 30 && g < 30 && b < 30 && a > 200) {
          black++;
          if (!blackBbox) blackBbox = { minX: x, minY: y, maxX: x, maxY: y };
          else {
            if (x < blackBbox.minX) blackBbox.minX = x;
            if (y < blackBbox.minY) blackBbox.minY = y;
            if (x > blackBbox.maxX) blackBbox.maxX = x;
            if (y > blackBbox.maxY) blackBbox.maxY = y;
          }
        } else if (r > 200 && g < 50 && b < 50 && a > 200) red++;
        else other++;
      }
    }
    return { width: w, height: h, black, red, transparent, other, blackBbox };
  });
  console.log('LAYER TEXTURE after fill:', texProbe);

  // Read composite and count black (spiral) vs red (fill) pixels
  const probe = await page.evaluate(async () => {
    const read = (window as unknown as {
      __readCompositedPixels?: () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    }).__readCompositedPixels;
    if (!read) return null;
    const p = await read();
    if (!p) return null;
    const w = p.width, h = p.height;
    const data = p.pixels;
    let black = 0, red = 0;
    let blackBbox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((h - 1 - y) * w + x) * 4;
        const r = data[i] ?? 0, g = data[i+1] ?? 0, b = data[i+2] ?? 0, a = data[i+3] ?? 0;
        if (a > 200 && r < 30 && g < 30 && b < 30) {
          black++;
          if (!blackBbox) blackBbox = { minX: x, minY: y, maxX: x, maxY: y };
          else {
            if (x < blackBbox.minX) blackBbox.minX = x;
            if (y < blackBbox.minY) blackBbox.minY = y;
            if (x > blackBbox.maxX) blackBbox.maxX = x;
            if (y > blackBbox.maxY) blackBbox.maxY = y;
          }
        } else if (a > 200 && r > 200 && g < 50 && b < 50) {
          red++;
        }
      }
    }
    return { width: w, height: h, black, red, blackBbox };
  });
  console.log('composite after fill:', probe);

  // The fill must preserve the spiral: after aligning to bottom and filling
  // the transparent area with red, the black spiral pixels should still be
  // visible in the composite.
  if (!probe) throw new Error('composite readback failed');
  if (probe.black < 100) {
    throw new Error(`spiral was destroyed by fill — only ${probe.black} black pixels remain`);
  }
  if (probe.red < 1000) {
    throw new Error(`fill did not paint red — only ${probe.red} red pixels`);
  }
});
