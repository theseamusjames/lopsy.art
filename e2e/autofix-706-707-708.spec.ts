import { test, expect, type Page } from './fixtures';

// Coverage for the nightly autofix batch:
// - issue #706 (path anchor edits recorded in undo history)
// - issue #707 (move tool moves every selected layer)
// - issue #708 (Cmd+drag from ruler snaps guide to fractional layout stops)

async function createDocument(page: Page, w = 400, h = 400) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w, h },
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
      const sx = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
      const sy = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
      return { x: rect.left + sx, y: rect.top + sy };
    },
    { docX, docY },
  );
}

async function clickAtDoc(page: Page, x: number, y: number) {
  const pos = await docToScreen(page, x, y);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(50);
}

test.describe('#706 — path edits are recorded in undo history', () => {
  test('dragging an anchor pushes an undo entry that restores the old position', async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires desktop pen-tool UI');
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    // Draw a two-anchor open path, commit with Enter.
    await clickAtDoc(page, 100, 100);
    await clickAtDoc(page, 200, 100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Confirm the path exists and grab its ID for selection.
    const pathId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: Array<{ id: string }>; selectPath: (id: string) => void };
      };
      const p = store.getState().paths[0];
      if (p) store.getState().selectPath(p.id);
      return p?.id ?? null;
    });
    expect(pathId).not.toBeNull();

    // Drag the second anchor from (200, 100) down to (200, 180).
    const start = await docToScreen(page, 200, 100);
    const end = await docToScreen(page, 200, 180);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const anchorAfterDrag = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: Array<{ anchors: Array<{ point: { x: number; y: number } }> }> };
      };
      return store.getState().paths[0]!.anchors[1]!.point;
    });
    // Rough — anchor may not land exactly on (200,180) due to zoom rounding,
    // but should be far from the original (200,100).
    expect(anchorAfterDrag.y).toBeGreaterThan(150);

    // Undo — anchor must go back to y≈100.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await page.waitForTimeout(100);

    const anchorAfterUndo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: Array<{ anchors: Array<{ point: { x: number; y: number } }> }> };
      };
      return store.getState().paths[0]!.anchors[1]!.point;
    });
    expect(Math.abs(anchorAfterUndo.y - 100)).toBeLessThan(5);
    expect(Math.abs(anchorAfterUndo.x - 200)).toBeLessThan(5);
  });
});

test.describe('#707 — move tool translates every selected layer', () => {
  test('dragging with two layers selected moves both', async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires desktop layer panel interactions');
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Two raster layers at known positions, both selected. We seed them via
    // the store rather than the layer panel because layer creation +
    // multi-select via panel clicks is verbose; the move-tool interaction we
    // care about still runs through the real pointer path below.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          addLayer: () => void;
          document: {
            layers: Array<{ id: string; type: string; x: number; y: number; width?: number; height?: number }>;
            activeLayerId: string | null;
            selectedLayerIds: readonly string[];
          };
        };
        setState: (updater: (s: unknown) => unknown) => void;
      };
      store.getState().addLayer();
      const layers = store.getState().document.layers;
      const raster = layers.filter((l) => l.type === 'raster');
      const a = raster[0]!;
      const b = raster[raster.length - 1]!;
      // Give each layer distinct bounds so the test can distinguish them
      // when reading positions back.
      store.setState((s: unknown) => {
        const state = s as { document: { layers: unknown[] } };
        return {
          document: {
            ...state.document,
            layers: (state.document.layers as Array<{ id: string; type: string; x?: number; y?: number; width?: number; height?: number }>).map((l) => {
              if (l.id === a.id) return { ...l, x: 40, y: 40, width: 60, height: 60 };
              if (l.id === b.id) return { ...l, x: 200, y: 200, width: 60, height: 60 };
              return l;
            }),
            activeLayerId: a.id,
            selectedLayerIds: [a.id, b.id],
          },
        };
      });
    });

    // Move tool.
    await page.keyboard.press('v');
    await page.waitForTimeout(100);

    const posBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; type: string; x: number; y: number }> } };
      };
      const rasters = store.getState().document.layers.filter((l) => l.type === 'raster');
      return { a: { x: rasters[0]!.x, y: rasters[0]!.y }, b: { x: rasters[1]!.x, y: rasters[1]!.y } };
    });

    // Drag on the active (first) raster — from (70,70) to (100,90) in doc space.
    const start = await docToScreen(page, 70, 70);
    const end = await docToScreen(page, 100, 90);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const posAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; type: string; x: number; y: number }> } };
      };
      const rasters = store.getState().document.layers.filter((l) => l.type === 'raster');
      return { a: { x: rasters[0]!.x, y: rasters[0]!.y }, b: { x: rasters[1]!.x, y: rasters[1]!.y } };
    });

    // Both layers should have shifted by roughly the same (dx, dy).
    const dxA = posAfter.a.x - posBefore.a.x;
    const dyA = posAfter.a.y - posBefore.a.y;
    const dxB = posAfter.b.x - posBefore.b.x;
    const dyB = posAfter.b.y - posBefore.b.y;

    expect(Math.abs(dxA)).toBeGreaterThan(5);
    expect(Math.abs(dyA)).toBeGreaterThan(5);
    // Sibling matches the active layer's translation exactly.
    expect(dxB).toBe(dxA);
    expect(dyB).toBe(dyA);
  });
});

test.describe('#708 — Cmd-hover on the ruler snaps guides to fractional stops', () => {
  test('Cmd-click on the horizontal ruler places a guide at a clean fraction', async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers hidden on touch UIs');
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page, 400, 300);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Ensure rulers + guides are on so the click on the ruler creates a guide.
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          showRulers: boolean; showGuides: boolean;
          setShowRulers?: (v: boolean) => void; setShowGuides?: (v: boolean) => void;
        };
        setState?: (updater: unknown) => void;
      };
      const s = ui.getState();
      if (!s.showRulers && s.setShowRulers) s.setShowRulers(true);
      else if (!s.showRulers && ui.setState) ui.setState({ showRulers: true });
      if (!s.showGuides && s.setShowGuides) s.setShowGuides(true);
      else if (!s.showGuides && ui.setState) ui.setState({ showGuides: true });
    });

    // Pick a doc-X close to (but not exactly on) 1/3 of the 400px width so we
    // can verify the snap. 1/3 * 400 ≈ 133.33 → rounded to 133.
    const nearOneThird = await docToScreen(page, 130, 5);
    // The ruler sits above the canvas — screenY 5 lands on it. Cmd+click.
    await page.keyboard.down('Meta');
    await page.mouse.click(nearOneThird.x, nearOneThird.y);
    await page.keyboard.up('Meta');
    await page.waitForTimeout(150);

    const guides = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { guides: Array<{ orientation: 'horizontal' | 'vertical'; position: number }> };
      };
      return ui.getState().guides;
    });
    // Expect a vertical guide snapped to ~133 (1/3 of 400).
    const vertical = guides.filter((g) => g.orientation === 'vertical');
    expect(vertical.length).toBeGreaterThan(0);
    expect(vertical.some((g) => Math.abs(g.position - 133) <= 1)).toBe(true);
  });
});
