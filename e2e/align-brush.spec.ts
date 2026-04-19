import { test, expect, type Page } from './fixtures';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 400, transparent = true) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
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
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function drawSmallCircle(page: Page, docX: number, docY: number) {
  const s = await docToScreen(page, docX, docY);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + 2, s.y + 2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function getLayerPosition(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> };
      };
    };
    const s = store.getState();
    const layer = s.document.layers.find((l) => l.id === s.document.activeLayerId);
    return layer ? { x: layer.x, y: layer.y, w: layer.width, h: layer.height } : null;
  });
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

async function clickAlignButton(page: Page, label: string) {
  await page.click(`button[aria-label="${label}"]`);
  await page.waitForTimeout(150);
}

test.describe('Align after brush stroke (GPU-only content)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    // Match the user's real repro: 1920x1080 white-bg doc (Web 1080p default).
    // Background layer is opaque white; Layer 1 is the transparent active layer.
    await createDocument(page, 1920, 1080, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
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
      store.getState().setBrushSize(20);
      store.getState().setBrushHardness(100);
      store.getState().setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
    });
  });

  test('letter-like shape (multi-segment stroke) centers correctly', async ({ page }) => {
    // Simulate drawing a letter in the top-left with multiple brush strokes
    const strokes: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
      [{ x: 50, y: 80 }, { x: 100, y: 80 }],
      [{ x: 50, y: 80 }, { x: 50, y: 130 }],
      [{ x: 50, y: 105 }, { x: 90, y: 105 }],
      [{ x: 90, y: 80 }, { x: 90, y: 130 }],
    ];
    for (const [from, to] of strokes) {
      const s = await docToScreen(page, from.x, from.y);
      const e = await docToScreen(page, to.x, to.y);
      await page.mouse.move(s.x, s.y);
      await page.mouse.down();
      await page.mouse.move(e.x, e.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(150);
    }

    const before = await getLayerPosition(page);
    console.log('[letter] before:', before);

    await selectMoveTool(page);
    await clickAlignButton(page, 'Align center horizontally');
    const afterH = await getLayerPosition(page);
    console.log('[letter] after center-h:', afterH);

    await clickAlignButton(page, 'Align center vertically');
    const afterV = await getLayerPosition(page);
    console.log('[letter] after center-v:', afterV);

    await page.screenshot({ path: 'test-results/screenshots/letter-align-after.png' });

    // Post-bake content in texture-local coords
    const post = await page.evaluate(async () => {
      const readPixels = (window as unknown as Record<string, unknown>).__readLayerPixels as
        | ((id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)
        | undefined;
      if (!readPixels) return null;
      const r = await readPixels();
      if (!r || r.width === 0) return null;
      let minX = r.width, minY = r.height, maxX = -1, maxY = -1;
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          if ((r.pixels[(y * r.width + x) * 4 + 3] ?? 0) > 0) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { w: r.width, h: r.height, minX, minY, maxX, maxY };
    });
    console.log('[letter] post-bake layer texture bounds:', post);

    expect(afterV).not.toBeNull();

    // Content center should land at doc center (960, 540) ± a few px.
    if (post && afterV && post.maxX >= 0) {
      const contentW = post.maxX - post.minX + 1;
      const contentH = post.maxY - post.minY + 1;
      const contentCenterX = afterV.x + post.minX + contentW / 2;
      const contentCenterY = afterV.y + post.minY + contentH / 2;
      console.log(`[letter] content center: (${contentCenterX}, ${contentCenterY})`);
      expect(contentCenterX).toBeGreaterThan(960 - 5);
      expect(contentCenterX).toBeLessThan(960 + 5);
      expect(contentCenterY).toBeGreaterThan(540 - 5);
      expect(contentCenterY).toBeLessThan(540 + 5);
    }
  });

  test('align center-h then center-v places content at canvas center', async ({ page }) => {
    // Small circle in top-left
    await drawSmallCircle(page, 40, 40);

    const before = await getLayerPosition(page);
    console.log('before align:', before);

    // Diagnostics: GPU texture dims & content bounds in the texture
    const diag = await page.evaluate(async () => {
      const readPixels = (window as unknown as Record<string, unknown>).__readLayerPixels as
        | ((id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)
        | undefined;
      if (!readPixels) return { hasReader: false } as const;
      const r = await readPixels();
      if (!r || r.width === 0) return { hasReader: true, pixels: null } as const;
      let minX = r.width, minY = r.height, maxX = -1, maxY = -1;
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          if ((r.pixels[(y * r.width + x) * 4 + 3] ?? 0) > 0) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { hasReader: true, w: r.width, h: r.height, minX, minY, maxX, maxY } as const;
    });
    console.log('GPU readback:', diag);

    await selectMoveTool(page);

    await page.screenshot({ path: 'test-results/screenshots/align-before.png' });

    await clickAlignButton(page, 'Align center horizontally');
    const afterH = await getLayerPosition(page);
    console.log('after center-h:', afterH);
    await page.screenshot({ path: 'test-results/screenshots/align-after-h.png' });

    await clickAlignButton(page, 'Align center vertically');
    const afterV = await getLayerPosition(page);
    console.log('after center-v:', afterV);
    await page.screenshot({ path: 'test-results/screenshots/align-after-v.png' });

    // Post-bake diagnostics: the stroke should now be baked into the layer texture.
    const postDiag = await page.evaluate(async () => {
      const readPixels = (window as unknown as Record<string, unknown>).__readLayerPixels as
        | ((id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)
        | undefined;
      if (!readPixels) return { ok: false } as const;
      const r = await readPixels();
      if (!r || r.width === 0) return { ok: true, w: 0, h: 0 } as const;
      let minX = r.width, minY = r.height, maxX = -1, maxY = -1;
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          if ((r.pixels[(y * r.width + x) * 4 + 3] ?? 0) > 0) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { ok: true, w: r.width, h: r.height, minX, minY, maxX, maxY } as const;
    });
    console.log('POST-bake GPU readback (content in texture-local coords):', postDiag);

    // Independent check: inspect composited pixel output — where does the dot
    // actually end up in doc/screen space?
    const composited = await page.evaluate(async () => {
      const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        | (() => Promise<{ width: number; height: number; pixels: number[] } | null>)
        | undefined;
      if (!read) return null;
      return read();
    });
    if (composited) {
      let minX = composited.width, minY = composited.height, maxX = -1, maxY = -1;
      for (let y = 0; y < composited.height; y++) {
        for (let x = 0; x < composited.width; x++) {
          const i = (y * composited.width + x) * 4;
          // find dark pixels (brush is black) — need to differentiate from workspace bg
          const r = composited.pixels[i] ?? 0;
          const g = composited.pixels[i + 1] ?? 0;
          const b = composited.pixels[i + 2] ?? 0;
          const a = composited.pixels[i + 3] ?? 0;
          if (a > 50 && r < 40 && g < 40 && b < 40) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      console.log(`COMPOSITED dark-pixel bounds in canvas px: x=${minX}-${maxX} y=${minY}-${maxY} (canvas ${composited.width}x${composited.height})`);
    }

    // After centering both axes, the content should be centered in the doc.
    // We verify the layer moved significantly from the original top-left.
    expect(afterV).not.toBeNull();
    expect(afterH?.x).not.toBe(before?.x);
    expect(afterV?.y).not.toBe(before?.y);

    // Tighter check: the content CENTER should be at (docW/2, docH/2) ± a few px.
    // Compute the expected layer position using the texture-local content bounds.
    const dims = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { width: number; height: number } };
      };
      return { w: store.getState().document.width, h: store.getState().document.height };
    });
    if (postDiag.ok && 'minX' in postDiag && afterV && postDiag.maxX >= 0) {
      const contentW = postDiag.maxX - postDiag.minX + 1;
      const contentH = postDiag.maxY - postDiag.minY + 1;
      const contentCenterX = afterV.x + postDiag.minX + contentW / 2;
      const contentCenterY = afterV.y + postDiag.minY + contentH / 2;
      console.log(`Content center: (${contentCenterX}, ${contentCenterY}) — doc center: (${dims.w/2}, ${dims.h/2})`);
      expect(contentCenterX).toBeGreaterThan(dims.w / 2 - 5);
      expect(contentCenterX).toBeLessThan(dims.w / 2 + 5);
      expect(contentCenterY).toBeGreaterThan(dims.h / 2 - 5);
      expect(contentCenterY).toBeLessThan(dims.h / 2 + 5);
    }
  });
});
