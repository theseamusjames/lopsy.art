/**
 * PSD Layer Properties Round-Trip
 *
 * Builds a 10-layer document where each layer has overlapping shapes,
 * then applies a variety of blend modes, effects (color overlay, stroke,
 * drop shadow, inner/outer glow), and opacity values.  Exports to PSD,
 * refreshes, reimports, and asserts pixel-for-pixel equivalence.
 *
 * This test is intentionally strict — the composited output after the
 * PSD round-trip must match the original.  Any layer property that fails
 * to survive export → import will show up as a pixel diff.
 */
import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
    { timeout: 15_000 },
  );
}

async function createDocument(page: Page, width: number, height: number, transparent = false) {
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

async function addLayer(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addLayer: () => void;
        renameLayer: (id: string, name: string) => void;
        document: { activeLayerId: string };
      };
    };
    store.getState().addLayer();
    const id = store.getState().document.activeLayerId;
    store.getState().renameLayer(id, n);
    return id;
  }, name);
}

async function setActiveLayer(page: Page, layerId: string) {
  await page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { setActiveLayer: (id: string) => void };
    };
    store.getState().setActiveLayer(id);
  }, layerId);
}

/**
 * Paint a batch of rectangles and circles on a layer in one evaluate call,
 * avoiding the auto-crop issue that silently drops out-of-bounds pixels
 * when multiple paint calls happen sequentially.
 */
async function paintShapes(
  page: Page,
  layerId: string,
  shapes: Array<
    | { kind: 'rect'; x: number; y: number; w: number; h: number; color: { r: number; g: number; b: number; a: number } }
    | { kind: 'circle'; cx: number; cy: number; radius: number; color: { r: number; g: number; b: number; a: number } }
  >,
) {
  await page.evaluate(
    ({ lid, shapes }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string;
            width: number;
            height: number;
            layers: Array<{ id: string; width: number; height: number }>;
          };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
        get: (id: string) => ImageData | undefined;
      };
      const state = store.getState();
      state.pushHistory('Paint shapes');
      const existing = pixelData.get(lid);
      const layer = state.document.layers.find((l) => l.id === lid);
      const lw = existing?.width ?? layer?.width ?? state.document.width;
      const lh = existing?.height ?? layer?.height ?? state.document.height;
      const data = existing ?? new ImageData(lw, lh);

      for (const shape of shapes) {
        if (shape.kind === 'rect') {
          for (let py = shape.y; py < shape.y + shape.h; py++) {
            for (let px = shape.x; px < shape.x + shape.w; px++) {
              if (px < 0 || px >= data.width || py < 0 || py >= data.height) continue;
              const idx = (py * data.width + px) * 4;
              data.data[idx] = shape.color.r;
              data.data[idx + 1] = shape.color.g;
              data.data[idx + 2] = shape.color.b;
              data.data[idx + 3] = shape.color.a;
            }
          }
        } else {
          for (let y = 0; y < data.height; y++) {
            for (let x = 0; x < data.width; x++) {
              const dx = x - shape.cx;
              const dy = y - shape.cy;
              if (dx * dx + dy * dy <= shape.radius * shape.radius) {
                const idx = (y * data.width + x) * 4;
                data.data[idx] = shape.color.r;
                data.data[idx + 1] = shape.color.g;
                data.data[idx + 2] = shape.color.b;
                data.data[idx + 3] = shape.color.a;
              }
            }
          }
        }
      }

      state.updateLayerPixelData(lid, data);
    },
    { lid: layerId, shapes },
  );
}

async function pushHistory(page: Page, label = 'Action') {
  await page.evaluate((lbl) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory(lbl);
  }, label);
}

async function setBlendMode(page: Page, layerId: string, mode: string) {
  await page.evaluate(
    ({ id, mode }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { updateLayerBlendMode: (id: string, mode: string) => void };
      };
      store.getState().updateLayerBlendMode(id, mode);
    },
    { id: layerId, mode },
  );
}

async function setLayerOpacity(page: Page, layerId: string, opacity: number) {
  await page.evaluate(
    ({ id, opacity }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { updateLayerOpacity: (id: string, opacity: number) => void };
      };
      store.getState().updateLayerOpacity(id, opacity);
    },
    { id: layerId, opacity },
  );
}

async function setLayerEffects(
  page: Page,
  layerId: string,
  effects: Record<string, unknown>,
) {
  await page.evaluate(
    ({ id, effects }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { updateLayerEffects: (id: string, effects: Record<string, unknown>) => void };
      };
      store.getState().updateLayerEffects(id, effects);
    },
    { id: layerId, effects },
  );
}

async function flushRenderAndWait(page: Page) {
  await page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { notifyRender: () => void };
    };
    store.getState().notifyRender();
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
  });
  await page.waitForTimeout(500);
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
      Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function pixelDiff(a: PixelSnapshot, b: PixelSnapshot): number {
  let count = 0;
  const len = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0));
    const dg = Math.abs((a.pixels[i + 1] ?? 0) - (b.pixels[i + 1] ?? 0));
    const db = Math.abs((a.pixels[i + 2] ?? 0) - (b.pixels[i + 2] ?? 0));
    const da = Math.abs((a.pixels[i + 3] ?? 0) - (b.pixels[i + 3] ?? 0));
    // Threshold of 3 accommodates PSD opacity quantization (f64 → u8 → f64)
    if (dr + dg + db + da > 3) count++;
  }
  return count;
}

interface DocSnapshot {
  width: number;
  height: number;
  layers: Array<{
    id: string;
    name: string;
    type: string;
    visible: boolean;
    opacity: number;
    blendMode: string;
    x: number;
    y: number;
    effects: {
      stroke: { enabled: boolean; color: { r: number; g: number; b: number; a: number }; width: number; position: string };
      dropShadow: { enabled: boolean; color: { r: number; g: number; b: number; a: number }; offsetX: number; offsetY: number; blur: number; spread: number; opacity: number };
      outerGlow: { enabled: boolean; color: { r: number; g: number; b: number; a: number }; size: number; spread: number; opacity: number };
      innerGlow: { enabled: boolean; color: { r: number; g: number; b: number; a: number }; size: number; spread: number; opacity: number };
      colorOverlay: { enabled: boolean; color: { r: number; g: number; b: number; a: number } };
    };
  }>;
  layerOrder: string[];
  activeLayerId: string;
}

async function getDocSnapshot(page: Page): Promise<DocSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          width: number;
          height: number;
          layers: Array<{
            id: string;
            name: string;
            type: string;
            visible: boolean;
            opacity: number;
            blendMode: string;
            x: number;
            y: number;
            effects: DocSnapshot['layers'][0]['effects'];
          }>;
          layerOrder: string[];
          activeLayerId: string;
        };
      };
    };
    const s = store.getState();
    return {
      width: s.document.width,
      height: s.document.height,
      layers: s.document.layers.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode,
        x: l.x,
        y: l.y,
        effects: l.effects,
      })),
      layerOrder: s.document.layerOrder,
      activeLayerId: s.document.activeLayerId,
    };
  });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('PSD Layer Properties Round-Trip', () => {
  test('10-layer document with blend modes, effects, and opacity survives PSD export/import', async ({ page, allowConsoleErrors }) => {
    (allowConsoleErrors as RegExp[]).push(/WebSocket connection/);
    test.setTimeout(180_000);

    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 500, 500, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const doc0 = await getDocSnapshot(page);
    const bgId = doc0.layers[0]!.id;

    // ── Layer 1 (Background): dark base with overlapping rects ──
    await paintShapes(page, bgId, [
      { kind: 'rect', x: 0, y: 0, w: 500, h: 500, color: { r: 20, g: 15, b: 30, a: 255 } },
      { kind: 'rect', x: 100, y: 100, w: 200, h: 200, color: { r: 40, g: 30, b: 60, a: 255 } },
    ]);

    // ── Layer 2: red/blue overlap — multiply, 80% opacity, color overlay ──
    const l2 = await addLayer(page, 'Red-Blue');
    await paintShapes(page, l2, [
      { kind: 'rect', x: 50, y: 50, w: 150, h: 150, color: { r: 220, g: 40, b: 40, a: 255 } },
      { kind: 'rect', x: 120, y: 120, w: 150, h: 150, color: { r: 40, g: 40, b: 220, a: 255 } },
    ]);
    await pushHistory(page, 'L2 props');
    await setBlendMode(page, l2, 'multiply');
    await setLayerOpacity(page, l2, 0.8);
    await setLayerEffects(page, l2, {
      colorOverlay: { enabled: true, color: { r: 0, g: 180, b: 80, a: 1 } },
    });

    // ── Layer 3: green/yellow circles — screen, 70% opacity, stroke ──
    const l3 = await addLayer(page, 'Green-Yellow');
    await paintShapes(page, l3, [
      { kind: 'circle', cx: 200, cy: 150, radius: 80, color: { r: 40, g: 200, b: 40, a: 255 } },
      { kind: 'circle', cx: 260, cy: 200, radius: 70, color: { r: 230, g: 230, b: 40, a: 255 } },
    ]);
    await pushHistory(page, 'L3 props');
    await setBlendMode(page, l3, 'screen');
    await setLayerOpacity(page, l3, 0.7);
    await setLayerEffects(page, l3, {
      stroke: { enabled: true, color: { r: 200, g: 30, b: 30, a: 1 }, width: 3, position: 'outside' },
    });

    // ── Layer 4: purple rects — overlay, 90% opacity, drop shadow ──
    const l4 = await addLayer(page, 'Purple');
    await paintShapes(page, l4, [
      { kind: 'rect', x: 300, y: 50, w: 120, h: 180, color: { r: 140, g: 40, b: 180, a: 255 } },
      { kind: 'rect', x: 350, y: 100, w: 100, h: 200, color: { r: 100, g: 20, b: 160, a: 230 } },
    ]);
    await pushHistory(page, 'L4 props');
    await setBlendMode(page, l4, 'overlay');
    await setLayerOpacity(page, l4, 0.9);
    await setLayerEffects(page, l4, {
      dropShadow: {
        enabled: true,
        color: { r: 0, g: 0, b: 0, a: 1 },
        offsetX: 6, offsetY: 6, blur: 10, spread: 0, opacity: 0.7,
      },
    });

    // ── Layer 5: cyan circle + orange rect — darken, 60% opacity, color overlay ──
    const l5 = await addLayer(page, 'Cyan-Orange');
    await paintShapes(page, l5, [
      { kind: 'circle', cx: 380, cy: 350, radius: 90, color: { r: 0, g: 220, b: 220, a: 255 } },
      { kind: 'rect', x: 320, y: 280, w: 100, h: 100, color: { r: 240, g: 140, b: 20, a: 255 } },
    ]);
    await pushHistory(page, 'L5 props');
    await setBlendMode(page, l5, 'darken');
    await setLayerOpacity(page, l5, 0.6);
    await setLayerEffects(page, l5, {
      colorOverlay: { enabled: true, color: { r: 30, g: 30, b: 200, a: 1 } },
    });

    // ── Layer 6: magenta shapes — lighten, 75% opacity, stroke ──
    const l6 = await addLayer(page, 'Magenta');
    await paintShapes(page, l6, [
      { kind: 'rect', x: 30, y: 300, w: 180, h: 100, color: { r: 200, g: 20, b: 140, a: 255 } },
      { kind: 'circle', cx: 130, cy: 370, radius: 60, color: { r: 255, g: 80, b: 180, a: 230 } },
    ]);
    await pushHistory(page, 'L6 props');
    await setBlendMode(page, l6, 'lighten');
    await setLayerOpacity(page, l6, 0.75);
    await setLayerEffects(page, l6, {
      stroke: { enabled: true, color: { r: 255, g: 255, b: 255, a: 1 }, width: 2, position: 'center' },
    });

    // ── Layer 7: white/gray rects — soft-light, 85% opacity, inner glow ──
    const l7 = await addLayer(page, 'White-Gray');
    await paintShapes(page, l7, [
      { kind: 'rect', x: 220, y: 320, w: 100, h: 140, color: { r: 240, g: 240, b: 240, a: 255 } },
      { kind: 'rect', x: 260, y: 370, w: 120, h: 100, color: { r: 140, g: 140, b: 140, a: 255 } },
    ]);
    await pushHistory(page, 'L7 props');
    await setBlendMode(page, l7, 'soft-light');
    await setLayerOpacity(page, l7, 0.85);
    await setLayerEffects(page, l7, {
      innerGlow: { enabled: true, color: { r: 255, g: 200, b: 100, a: 1 }, size: 8, spread: 0, opacity: 0.6 },
    });

    // ── Layer 8: dark shapes — hard-light, 50% opacity, outer glow ──
    const l8 = await addLayer(page, 'Dark');
    await paintShapes(page, l8, [
      { kind: 'circle', cx: 100, cy: 200, radius: 50, color: { r: 30, g: 30, b: 50, a: 255 } },
      { kind: 'rect', x: 60, y: 210, w: 120, h: 80, color: { r: 50, g: 20, b: 60, a: 240 } },
    ]);
    await pushHistory(page, 'L8 props');
    await setBlendMode(page, l8, 'hard-light');
    await setLayerOpacity(page, l8, 0.5);
    await setLayerEffects(page, l8, {
      outerGlow: { enabled: true, color: { r: 100, g: 200, b: 255, a: 1 }, size: 12, spread: 0, opacity: 0.7 },
    });

    // ── Layer 9: mixed — color-dodge, 65% opacity, color overlay + stroke ──
    const l9 = await addLayer(page, 'Mixed');
    await paintShapes(page, l9, [
      { kind: 'rect', x: 350, y: 20, w: 130, h: 100, color: { r: 180, g: 100, b: 60, a: 255 } },
      { kind: 'circle', cx: 420, cy: 80, radius: 55, color: { r: 60, g: 100, b: 180, a: 240 } },
    ]);
    await pushHistory(page, 'L9 props');
    await setBlendMode(page, l9, 'color-dodge');
    await setLayerOpacity(page, l9, 0.65);
    await setLayerEffects(page, l9, {
      colorOverlay: { enabled: true, color: { r: 255, g: 140, b: 0, a: 1 } },
      stroke: { enabled: true, color: { r: 0, g: 0, b: 0, a: 1 }, width: 4, position: 'outside' },
    });

    // ── Layer 10: bright — difference, 55% opacity, drop shadow ──
    const l10 = await addLayer(page, 'Bright');
    await paintShapes(page, l10, [
      { kind: 'circle', cx: 250, cy: 250, radius: 100, color: { r: 255, g: 200, b: 50, a: 255 } },
      { kind: 'rect', x: 200, y: 200, w: 100, h: 100, color: { r: 50, g: 200, b: 255, a: 220 } },
    ]);
    await pushHistory(page, 'L10 props');
    await setBlendMode(page, l10, 'difference');
    await setLayerOpacity(page, l10, 0.55);
    await setLayerEffects(page, l10, {
      dropShadow: {
        enabled: true,
        color: { r: 0, g: 0, b: 0, a: 1 },
        offsetX: 4, offsetY: 4, blur: 8, spread: 0, opacity: 0.5,
      },
    });

    // ── Verify composition before export ──
    const finalDoc = await getDocSnapshot(page);
    const rasterLayers = finalDoc.layers.filter((l) => l.type !== 'group');
    expect(rasterLayers.length).toBe(10);

    await flushRenderAndWait(page);
    await page.screenshot({ path: 'e2e/screenshots/psd-layer-props-original.png' });

    // ── Capture reference snapshot ──
    const referenceSnapshot = await snapshot(page);
    expect(referenceSnapshot.width).toBeGreaterThan(0);
    expect(referenceSnapshot.height).toBeGreaterThan(0);

    // Also capture per-layer metadata for structure comparison
    const referenceLayerNames = rasterLayers.map((l) => l.name);
    const referenceBlendModes = rasterLayers.map((l) => l.blendMode);
    const referenceOpacities = rasterLayers.map((l) => l.opacity);

    // ── Export PSD ──
    await flushRenderAndWait(page);

    const psdDownloadPromise = page.waitForEvent('download');
    await page.evaluate(() => {
      return import('/src/io/psd.ts').then((mod) => {
        mod.exportPsdFile(16);
      });
    });
    const psdDownload = await psdDownloadPromise;
    expect(psdDownload.suggestedFilename()).toMatch(/\.psd$/);

    const psdStream = await psdDownload.createReadStream();
    const psdChunks: Buffer[] = [];
    for await (const chunk of psdStream) {
      psdChunks.push(chunk as Buffer);
    }
    const psdBuffer = Buffer.concat(psdChunks);
    expect(psdBuffer.length).toBeGreaterThan(1000);
    expect(psdBuffer.subarray(0, 4).toString('ascii')).toBe('8BPS');

    // ── Refresh and reimport PSD ──
    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });

    const psdBase64 = psdBuffer.toString('base64');
    await page.evaluate(async (b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const { importPsdFile } = await import('/src/io/psd.ts');
      await importPsdFile(bytes, 'layer-props-roundtrip');
    }, psdBase64);

    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 15_000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/psd-layer-props-reimport.png' });

    // ── Verify layer structure survived ──
    const reimportDoc = await getDocSnapshot(page);
    const reimportRasters = reimportDoc.layers.filter((l) => l.type !== 'group');

    // Layer names should be preserved
    const reimportNames = reimportRasters.map((l) => l.name);
    expect(reimportNames).toEqual(referenceLayerNames);

    // Blend modes should be preserved
    const reimportBlendModes = reimportRasters.map((l) => l.blendMode);
    expect(reimportBlendModes).toEqual(referenceBlendModes);

    // Opacities should be preserved (within PSD 0-255 quantization tolerance)
    for (let i = 0; i < referenceOpacities.length; i++) {
      const expected = referenceOpacities[i]!;
      const actual = reimportRasters[i]!.opacity;
      expect(Math.abs(expected - actual)).toBeLessThan(0.01);
    }

    // Effects should be preserved
    for (const reimportLayer of reimportRasters) {
      const originalLayer = rasterLayers.find((l) => l.name === reimportLayer.name);
      if (!originalLayer) continue;

      const origFx = originalLayer.effects;
      const reimportFx = reimportLayer.effects;

      expect(reimportFx.colorOverlay.enabled).toBe(origFx.colorOverlay.enabled);
      if (origFx.colorOverlay.enabled) {
        expect(reimportFx.colorOverlay.color.r).toBe(origFx.colorOverlay.color.r);
        expect(reimportFx.colorOverlay.color.g).toBe(origFx.colorOverlay.color.g);
        expect(reimportFx.colorOverlay.color.b).toBe(origFx.colorOverlay.color.b);
      }

      expect(reimportFx.stroke.enabled).toBe(origFx.stroke.enabled);
      if (origFx.stroke.enabled) {
        expect(reimportFx.stroke.color.r).toBe(origFx.stroke.color.r);
        expect(reimportFx.stroke.color.g).toBe(origFx.stroke.color.g);
        expect(reimportFx.stroke.color.b).toBe(origFx.stroke.color.b);
        expect(reimportFx.stroke.width).toBe(origFx.stroke.width);
        expect(reimportFx.stroke.position).toBe(origFx.stroke.position);
      }

      expect(reimportFx.dropShadow.enabled).toBe(origFx.dropShadow.enabled);
      if (origFx.dropShadow.enabled) {
        expect(reimportFx.dropShadow.offsetX).toBe(origFx.dropShadow.offsetX);
        expect(reimportFx.dropShadow.offsetY).toBe(origFx.dropShadow.offsetY);
        expect(reimportFx.dropShadow.blur).toBe(origFx.dropShadow.blur);
        expect(reimportFx.dropShadow.opacity).toBeCloseTo(origFx.dropShadow.opacity, 2);
      }

      expect(reimportFx.outerGlow.enabled).toBe(origFx.outerGlow.enabled);
      if (origFx.outerGlow.enabled) {
        expect(reimportFx.outerGlow.size).toBe(origFx.outerGlow.size);
        expect(reimportFx.outerGlow.opacity).toBeCloseTo(origFx.outerGlow.opacity, 2);
      }

      expect(reimportFx.innerGlow.enabled).toBe(origFx.innerGlow.enabled);
      if (origFx.innerGlow.enabled) {
        expect(reimportFx.innerGlow.size).toBe(origFx.innerGlow.size);
        expect(reimportFx.innerGlow.opacity).toBeCloseTo(origFx.innerGlow.opacity, 2);
      }
    }

    // ── Compare composited pixels — must be pixel-for-pixel identical ──
    const reimportSnapshot = await snapshot(page);
    expect(reimportSnapshot.width).toBe(referenceSnapshot.width);
    expect(reimportSnapshot.height).toBe(referenceSnapshot.height);

    const diffCount = pixelDiff(referenceSnapshot, reimportSnapshot);
    const totalPixels = referenceSnapshot.width * referenceSnapshot.height;

    // Zero tolerance: every layer property must survive the round-trip
    expect(diffCount).toBe(0);
  });
});
