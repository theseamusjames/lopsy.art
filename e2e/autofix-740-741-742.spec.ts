import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  setForegroundColor,
  drawRect,
  getPixelAt,
  getEditorState,
  docToScreen,
  addLayer,
  setActiveLayer,
} from './helpers';

// Coverage for the nightly autofix batch:
// - #740 (layer-switch no longer stalls on a full-res cropLayerToContent
//   readback — the crop is deferred to an idle callback and skipped when
//   the user comes right back to the layer)
// - #741 (LayerThumbnail's readback is coalesced through an idle-time
//   queue, so no pipeline-flushing glReadPixels fires from a React
//   effect on the stroke-end frame)
// - #742 (fill's 122 MB expandLayerForEditing round-trip is gone, but the
//   moved-layer regression from #722 stays fixed — the fill handler
//   reconciles JS bounds after the engine's ensure_layer_full_size via
//   syncLayerAfterFullSize)

test.describe('#740 — layer switch does not synchronously read back the previous layer', () => {
  test('two rapid switches leave layer bounds untouched on the switch frame', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // A second layer to switch to. Both raster.
    const secondId = await addLayer(page);
    const firstId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layerOrder: string[]; activeLayerId: string } };
      };
      const s = store.getState();
      return s.document.layerOrder.find((id) => id !== s.document.activeLayerId)!;
    });

    // Give the first layer content so the pre-fix code path would have
    // paid a real readback + CPU scan on switch (not a lazy 1x1 no-op).
    await setActiveLayer(page, firstId);
    await drawRect(page, 40, 40, 100, 80, { r: 200, g: 60, b: 60 });

    const beforeSwitch = await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; x: number; y: number; width: number; height: number }>;
          };
        };
      };
      const l = store.getState().document.layers.find((l) => l.id === id)!;
      return { x: l.x, y: l.y, width: l.width, height: l.height };
    }, firstId);

    // Switch to the second layer, then check IMMEDIATELY — before the
    // deferred idle callback has any chance to run. Under the pre-#740
    // synchronous code path, cropLayerToContent had already reshaped
    // firstId's bounds by the time the click returned.
    await setActiveLayer(page, secondId);
    const rightAfter = await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; x: number; y: number; width: number; height: number }>;
          };
        };
      };
      const l = store.getState().document.layers.find((l) => l.id === id)!;
      return { x: l.x, y: l.y, width: l.width, height: l.height };
    }, firstId);
    expect(rightAfter).toEqual(beforeSwitch);
  });

  test('switching back to a layer before the crop runs leaves the layer at full size', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    const secondId = await addLayer(page);
    const firstId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layerOrder: string[]; activeLayerId: string } };
      };
      const s = store.getState();
      return s.document.layerOrder.find((id) => id !== s.document.activeLayerId)!;
    });

    // Give the first layer painted content well inside the doc.
    await setActiveLayer(page, firstId);
    await drawRect(page, 40, 40, 100, 80, { r: 200, g: 60, b: 60 });

    const boundsBefore = await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; width: number; height: number }>;
          };
        };
      };
      const l = store.getState().document.layers.find((l) => l.id === id)!;
      return { width: l.width, height: l.height };
    }, firstId);

    // Switch away and IMMEDIATELY back — the deferred crop must be
    // cancelled, so the layer never shrinks. Under the pre-fix
    // synchronous crop it would have been reshaped even for a
    // single-frame off-visit.
    await setActiveLayer(page, secondId);
    await setActiveLayer(page, firstId);
    // Give the idle scheduler plenty of time — its callback must have
    // been cancelled by the switch-back.
    await page.waitForTimeout(800);

    const boundsAfter = await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; width: number; height: number }>;
          };
        };
      };
      const l = store.getState().document.layers.find((l) => l.id === id)!;
      return { width: l.width, height: l.height };
    }, firstId);
    expect(boundsAfter).toEqual(boundsBefore);
  });
});

test.describe('#741 — thumbnail readback is coalesced off the interactive frame', () => {
  test('painting on the active layer paints its thumbnail via the queue, not inline', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // Paint a fully-opaque bright color so the thumbnail must reflect it
    // (transparent-only fill would leave a fresh canvas — no
    // meaningful contract to check).
    await drawRect(page, 20, 20, 360, 260, { r: 40, g: 220, b: 40 });
    // Let the coalescer's idle callback drain.
    await page.waitForTimeout(500);

    const activeId = (await getEditorState(page)).document.activeLayerId;

    // Read the LayerThumbnail canvas — the one inside the active layer's row.
    const painted = await page.evaluate((id) => {
      const row = document.querySelector(`[data-layer-id="${id}"]`);
      if (!row) return null;
      const cvs = Array.from(row.querySelectorAll('canvas')) as HTMLCanvasElement[];
      const thumb = cvs.find((c) => c.width === 24 && c.height === 24);
      if (!thumb) return null;
      const ctx = thumb.getContext('2d');
      if (!ctx) return null;
      const img = ctx.getImageData(0, 0, 24, 24);
      let opaque = 0;
      let greens = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if ((img.data[i + 3] ?? 0) > 128) opaque++;
        if ((img.data[i + 1] ?? 0) > 150 && (img.data[i] ?? 0) < 120 && (img.data[i + 2] ?? 0) < 120) greens++;
      }
      return { opaque, greens };
    }, activeId);
    expect(painted).not.toBeNull();
    // Most of the 24*24 = 576 pixels should be opaque and green after
    // the coalescer has flushed.
    expect(painted!.opaque).toBeGreaterThan(300);
    expect(painted!.greens).toBeGreaterThan(200);
  });
});

test.describe('#742 — fill on a moved layer still lands at the click, without a pre-fill readback', () => {
  test('non-contiguous fill on a moved layer replaces the clicked color', async ({ page, isMobile }) => {
    test.skip(isMobile, 'fill tool tests use desktop pointer events');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);

    // Same regression scenario as autofix-721-722-723-724: layer offset != 0.
    // Before #742, dropping expandLayerForEditing here re-broke the fill
    // on a moved layer. The re-land only stays green if
    // syncLayerAfterFullSize runs after each fill path.
    await drawRect(page, 40, 40, 80, 60, { r: 220, g: 30, b: 30 });
    await page.waitForTimeout(80);

    await selectTool(page, 'move');
    const dragStart = await docToScreen(page, 80, 70);
    const dragEnd = await docToScreen(page, 110, 100);
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    // Sanity: layer offset really is non-zero.
    const st = await getEditorState(page);
    const activeId = st.document.activeLayerId;
    const active = st.document.layers.find((l) => l.id === activeId)!;
    expect(active.x !== 0 || active.y !== 0).toBe(true);

    await selectTool(page, 'fill');
    await page.evaluate(() => {
      const store = (window as unknown as { __toolSettingsStore: {
        getState: () => { setFillSetting: (k: string, v: number | boolean) => void };
      } }).__toolSettingsStore;
      store.getState().setFillSetting('contiguous', false);
      store.getState().setFillSetting('tolerance', 10);
    });
    await setForegroundColor(page, 20, 220, 60);

    const fillClick = await docToScreen(page, 80, 70);
    await page.mouse.move(fillClick.x, fillClick.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);

    const filled = await getPixelAt(page, 80, 70);
    expect(filled.g).toBeGreaterThan(180);
    expect(filled.r).toBeLessThan(60);
  });

  test('contiguous fill on a moved layer still lands at the click', async ({ page, isMobile }) => {
    test.skip(isMobile, 'fill tool tests use desktop pointer events');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);

    // The BFS path (contiguous fill on non-empty layer) also calls
    // ensure_layer_full_size inside applyFillToLayer and needs the same
    // bounds reconciliation.
    await drawRect(page, 40, 40, 80, 60, { r: 220, g: 30, b: 30 });
    await page.waitForTimeout(80);

    await selectTool(page, 'move');
    const start = await docToScreen(page, 80, 70);
    const end = await docToScreen(page, 110, 100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    await selectTool(page, 'fill');
    await page.evaluate(() => {
      const store = (window as unknown as { __toolSettingsStore: {
        getState: () => { setFillSetting: (k: string, v: number | boolean) => void };
      } }).__toolSettingsStore;
      store.getState().setFillSetting('contiguous', true);
      store.getState().setFillSetting('tolerance', 10);
    });
    await setForegroundColor(page, 20, 60, 220);

    const fillClick = await docToScreen(page, 80, 70);
    await page.mouse.move(fillClick.x, fillClick.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);

    const filled = await getPixelAt(page, 80, 70);
    expect(filled.b).toBeGreaterThan(180);
    expect(filled.r).toBeLessThan(60);
  });

  test('fill click does not populate the layer JS pixel cache (no expandLayerForEditing)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'fill tool tests use desktop pointer events');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // Any raster content — the layer JS cache should stay empty because
    // the CPU BFS path reads via wasmReadLayerPixelsForFill (no store
    // side-effect) rather than through expandLayerForEditing.
    await drawRect(page, 20, 20, 60, 40, { r: 200, g: 50, b: 50 });
    await page.evaluate(() => {
      const px = (window as unknown as Record<string, unknown>).__pixelData as {
        remove: (id: string) => void;
      };
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      px.remove(store.getState().document.activeLayerId);
    });

    const priorCache = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      const px = (window as unknown as Record<string, unknown>).__pixelData as {
        get: (id: string) => unknown;
      };
      return px.get(store.getState().document.activeLayerId) !== undefined;
    });
    expect(priorCache).toBe(false);

    await selectTool(page, 'fill');
    await page.evaluate(() => {
      const store = (window as unknown as { __toolSettingsStore: {
        getState: () => { setFillSetting: (k: string, v: number | boolean) => void };
      } }).__toolSettingsStore;
      store.getState().setFillSetting('contiguous', false);
      store.getState().setFillSetting('tolerance', 10);
    });
    await setForegroundColor(page, 20, 220, 60);

    const fillClick = await docToScreen(page, 50, 40);
    await page.mouse.move(fillClick.x, fillClick.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);

    const cacheAfterFill = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      const px = (window as unknown as Record<string, unknown>).__pixelData as {
        get: (id: string) => unknown;
      };
      return px.get(store.getState().document.activeLayerId) !== undefined;
    });
    // Under the pre-fix code path, handleToolDown's needsPixelData gate
    // fired for activeTool === 'fill' and expandLayerForEditing populated
    // the JS cache with a full-canvas ImageData.
    expect(cacheAfterFill).toBe(false);
  });
});
