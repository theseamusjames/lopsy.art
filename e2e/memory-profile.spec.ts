import { test, expect, type Page } from '@playwright/test';

/**
 * Memory profiling test — run headed to include GPU memory.
 *
 *   npx playwright test e2e/memory-profile.spec.ts --headed
 *
 * Uses Chrome DevTools Protocol to measure JS heap, plus
 * performance.measureUserAgentSpecificMemory for total breakdown.
 */

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function snapshot(page: Page, label: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  await new Promise(r => setTimeout(r, 200));
  await cdp.send('HeapProfiler.collectGarbage');

  const heap = await cdp.send('Runtime.getHeapUsage') as { usedSize: number; totalSize: number };

  // Get performance.memory (Chrome-specific, includes ArrayBuffers)
  const perfMemory = await page.evaluate(() => {
    const perf = performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
    return perf.memory ? {
      usedJSHeapSize: perf.memory.usedJSHeapSize,
      totalJSHeapSize: perf.memory.totalJSHeapSize,
    } : null;
  });

  // Get WASM memory size
  const wasmMem = await page.evaluate(() => {
    // Check if the WASM module exposes memory
    const w = window as unknown as Record<string, unknown>;
    if (w.__wasmMemory) {
      return (w.__wasmMemory as WebAssembly.Memory).buffer.byteLength;
    }
    return null;
  });

  // Get store details
  const storeInfo = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; name: string; x: number; y: number; width?: number; height?: number }> };
        layerPixelData: Map<string, ImageData>;
        sparseLayerData: Map<string, { sparse: { count: number; indices: { byteLength: number }; rgba: { byteLength: number }; width: number; height: number } }>;
        undoStack?: Array<unknown>;
        redoStack?: Array<unknown>;
      };
    };
    const state = store.getState();

    // Estimate undo stack memory — includes compressed GPU snapshots
    const undoStack = (state as unknown as { undoStack: Array<{ layerPixelData?: Map<string, ImageData>; gpuSnapshots?: Map<string, Uint8Array>; sparseLayerData?: Map<string, unknown>; metadataOnly?: boolean; label?: string }> }).undoStack ?? [];
    const redoStack = (state as unknown as { redoStack: Array<{ gpuSnapshots?: Map<string, Uint8Array>; metadataOnly?: boolean }> }).redoStack ?? [];
    let undoBytes = 0;
    const undoDetails: Array<{ label: string; metadataOnly: boolean; gpuBytes: number; denseBytes: number }> = [];
    for (const entry of undoStack) {
      let gpuBytes = 0;
      let denseBytes = 0;
      if (entry.gpuSnapshots) {
        for (const blob of entry.gpuSnapshots.values()) {
          gpuBytes += blob.byteLength;
        }
      }
      if (entry.layerPixelData) {
        for (const data of entry.layerPixelData.values()) {
          denseBytes += data.data.byteLength;
        }
      }
      undoBytes += gpuBytes + denseBytes;
      undoDetails.push({ label: entry.label ?? '?', metadataOnly: !!entry.metadataOnly, gpuBytes, denseBytes });
    }
    let redoBytes = 0;
    for (const entry of redoStack) {
      if (entry.gpuSnapshots) {
        for (const blob of entry.gpuSnapshots.values()) {
          redoBytes += blob.byteLength;
        }
      }
    }

    const layers = state.document.layers.map(l => {
      const dense = state.layerPixelData.get(l.id);
      const sparse = state.sparseLayerData.get(l.id);
      return {
        name: l.name,
        pos: `${l.x},${l.y}`,
        size: `${l.width ?? '?'}x${l.height ?? '?'}`,
        hasDense: !!dense,
        denseBytes: dense?.data.byteLength ?? 0,
        hasSparse: !!sparse,
        sparsePixels: sparse?.sparse.count ?? 0,
        sparseBytes: sparse ? (sparse.sparse.indices.byteLength + sparse.sparse.rgba.byteLength) : 0,
        sparseDims: sparse ? `${sparse.sparse.width}x${sparse.sparse.height}` : '',
      };
    });

    // Query actual GPU texture dimensions via WASM bridge
    let gpuLayerBytes = 0;
    const gpuTextures: Array<{ name: string; w: number; h: number; bytes: number }> = [];
    const wasmBridge = (window as unknown as Record<string, { getLayerTextureDimensions?: (e: unknown, id: string) => Uint32Array | null }>).__wasmBridge;
    const engineMod = (window as unknown as Record<string, { getEngine?: () => unknown }>).__engineState;
    const eng = engineMod?.getEngine?.();
    for (const l of state.document.layers) {
      let w = 0;
      let h = 0;
      if (eng && wasmBridge?.getLayerTextureDimensions) {
        const dims = wasmBridge.getLayerTextureDimensions(eng, l.id);
        if (dims && dims.length >= 2) {
          w = dims[0] ?? 0;
          h = dims[1] ?? 0;
        }
      }
      // Fallback to layer descriptor if bridge unavailable
      if (w === 0 && h === 0) {
        w = l.width ?? 0;
        h = l.height ?? 0;
      }
      if (w > 0 && h > 0) {
        const bytes = w * h * 4;
        gpuLayerBytes += bytes;
        gpuTextures.push({ name: l.name, w, h, bytes });
      }
    }
    // System textures: composite FBO + 2 scratch FBOs (all at doc size)
    const docW = state.document.width ?? 0;
    const docH = state.document.height ?? 0;
    const systemTexBytes = docW * docH * 4 * 3;
    const gpuTextureBytes = gpuLayerBytes + systemTexBytes;

    return {
      layers, undoEntries: undoStack.length, undoBytes, undoDetails,
      redoEntries: redoStack.length, redoBytes,
      gpuTextureBytes, gpuTextures, systemTexBytes,
    };
  });

  await cdp.detach();

  console.log(`\n=== ${label} ===`);
  console.log(`  JS Heap (CDP):     ${formatMB(heap.usedSize)}`);
  if (perfMemory) {
    console.log(`  JS Heap (perf):    ${formatMB(perfMemory.usedJSHeapSize)}`);
    console.log(`  JS Heap total:     ${formatMB(perfMemory.totalJSHeapSize)}`);
  }
  if (wasmMem !== null) {
    console.log(`  WASM memory:       ${formatMB(wasmMem)}`);
  }
  console.log(`  Undo stack:        ${storeInfo.undoEntries} entries, ${formatMB(storeInfo.undoBytes)}`);
  console.log(`  Redo stack:        ${storeInfo.redoEntries} entries, ${formatMB(storeInfo.redoBytes)}`);
  if (storeInfo.undoDetails.length > 0) {
    for (const d of storeInfo.undoDetails) {
      console.log(`    [${d.label}] gpu=${formatMB(d.gpuBytes)} dense=${formatMB(d.denseBytes)} metadataOnly=${d.metadataOnly}`);
    }
  }
  console.log(`  GPU textures:      ${formatMB(storeInfo.gpuTextureBytes)}`);
  console.log(`    System FBOs:     ${formatMB(storeInfo.systemTexBytes)} (composite + 2 scratch)`);
  for (const t of storeInfo.gpuTextures) {
    console.log(`    ${t.name.padEnd(15)} ${t.w}x${t.h} = ${formatMB(t.bytes)}`);
  }
  console.log(`  Layers:`);
  for (const l of storeInfo.layers) {
    const storage = l.hasDense
      ? `DENSE ${formatMB(l.denseBytes)}`
      : l.hasSparse
        ? `SPARSE ${l.sparsePixels}px = ${l.sparseBytes} bytes (dims ${l.sparseDims})`
        : 'empty';
    console.log(`    ${l.name.padEnd(15)} ${storage}`);
  }

  return {
    heapUsed: heap.usedSize,
    perfUsed: perfMemory?.usedJSHeapSize ?? heap.usedSize,
    perfTotal: perfMemory?.totalJSHeapSize ?? heap.totalSize,
    wasmMem: wasmMem ?? 0,
    gpuTextureBytes: storeInfo.gpuTextureBytes,
    storeInfo,
  };
}

test('memory profile: sparse layers should be tiny', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);

  // Create 4000x2000 document (white background + transparent layer)
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(4000, 2000, false);
  });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(500);

  // === SNAPSHOT 1: Fresh document ===
  const s1 = await snapshot(page, 'SNAPSHOT 1: Fresh document');

  // === Select Layer 1 and add two dots at opposite corners ===
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; name: string }> };
        setActiveLayer: (id: string) => void;
        getOrCreateLayerPixelData: (id: string) => ImageData;
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const layer1 = state.document.layers.find(l => l.name !== 'Background');
    if (!layer1) throw new Error('No Layer 1 found');
    state.setActiveLayer(layer1.id);

    state.pushHistory('Add dots');
    const data = state.getOrCreateLayerPixelData(layer1.id);

    // Dot at (0, 0) — red
    data.data[0] = 255;
    data.data[1] = 0;
    data.data[2] = 0;
    data.data[3] = 255;

    // Dot at (3999, 1999) — blue
    const idx2 = (1999 * 4000 + 3999) * 4;
    data.data[idx2] = 0;
    data.data[idx2 + 1] = 0;
    data.data[idx2 + 2] = 255;
    data.data[idx2 + 3] = 255;

    state.updateLayerPixelData(layer1.id, data);
  });
  await page.waitForTimeout(1000);

  // === SNAPSHOT 2: After two dots ===
  const s2 = await snapshot(page, 'SNAPSHOT 2: After two dots on Layer 1');

  // === Add a new empty layer ===
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { addLayer: () => void };
    };
    store.getState().addLayer();
  });
  await page.waitForTimeout(500);

  // === SNAPSHOT 3: After adding empty layer ===
  const s3 = await snapshot(page, 'SNAPSHOT 3: After adding empty layer');

  // === Switch to background layer ===
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; name: string }> };
        setActiveLayer: (id: string) => void;
      };
    };
    const state = store.getState();
    const bg = state.document.layers.find(l => l.name === 'Background');
    if (bg) state.setActiveLayer(bg.id);
  });
  await page.waitForTimeout(500);

  // === SNAPSHOT 4: After selecting background ===
  const s4 = await snapshot(page, 'SNAPSHOT 4: After selecting Background');

  // === FINAL SUMMARY ===
  const expectedLayerSize = 4000 * 2000 * 4;
  console.log('\n=== FINAL SUMMARY ===');
  console.log(`One full layer = ${formatMB(expectedLayerSize)}`);
  console.log(`JS heap growth (CDP):  ${formatMB(s4.heapUsed - s1.heapUsed)}`);
  console.log(`JS heap growth (perf): ${formatMB(s4.perfUsed - s1.perfUsed)}`);
  console.log(`Total JS heap (perf):  ${formatMB(s4.perfTotal)}`);
  console.log(`GPU texture memory:    ${formatMB(s4.gpuTextureBytes)}`);
  console.log(`GPU growth from S1:    ${formatMB(s4.gpuTextureBytes - s1.gpuTextureBytes)}`);
  console.log(`\nTotal estimated memory: ${formatMB(s4.perfUsed + s4.gpuTextureBytes)} (JS heap + GPU textures)`);

  // Assertions
  const layer1 = s4.storeInfo.layers.find(l => l.name === 'Layer 1');
  const addedLayer = s4.storeInfo.layers.find(l => l.name !== 'Background' && l.name !== 'Layer 1' && l.name !== 'Project');
  const bg = s4.storeInfo.layers.find(l => l.name === 'Background');

  expect(layer1?.hasSparse).toBe(true);
  expect(layer1?.hasDense).toBe(false);
  expect(layer1?.sparsePixels).toBeLessThanOrEqual(2);
  expect(layer1?.sparseBytes).toBeLessThan(100);
  expect(addedLayer?.hasDense).toBe(false);
  expect(bg?.hasDense).toBe(true);

  // CDP heap (actual JS objects, post-GC) should grow < 5 MB.
  // The performance.memory API includes WASM linear memory + GPU backing stores
  // which are outside our control (~60MB overhead for a WebGL 2 engine).
  const cdpGrowth = s4.heapUsed - s1.heapUsed;
  console.log(`\nCDP heap growth: ${formatMB(cdpGrowth)} (should be < 5 MB)`);
  console.log(`Undo stack total: ${formatMB(s4.storeInfo.undoBytes)} (compressed GPU snapshots)`);
  expect(cdpGrowth).toBeLessThan(5 * 1024 * 1024);
  // Undo stack stores compressed GPU snapshots; size depends on undo format and layer count
  expect(s4.storeInfo.undoBytes).toBeLessThan(200 * 1024 * 1024);
});
