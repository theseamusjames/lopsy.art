import { existsSync } from 'fs';
import { resolve } from 'path';
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  addLayer,
  setActiveLayer,
  addAdjustment,
  closeEffectsPanel,
  getRootGroupId,
  docToScreen,
} from './helpers';

const samplePath = resolve(import.meta.dirname, '..', 'sample.jpg');

/**
 * Memory profiling test — simulates a photo retouching session on a large
 * image (4000×6000) and checks that memory stays within reasonable bounds.
 *
 * Reproduces the scenario: open large photo → apply levels/curves/hue-sat →
 * add gradient layer with transparency → duplicate background into a group
 * with group adjustments.
 *
 * Run:
 *   npx playwright test e2e/memory-retouch-session.spec.ts --project=chromium
 *   npx playwright test e2e/memory-retouch-session.spec.ts --project=chromium --headed  # real GPU
 */

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

interface UndoBreakdown {
  entryIndex: number;
  label: string;
  layerCount: number;
  totalBytes: number;
  uniqueBlobs: number;
  blobSizes: number[];
}

interface SnapshotResult {
  label: string;
  heapUsed: number;
  perfUsed: number;
  perfTotal: number;
  wasmMem: number;
  gpuTextureBytes: number;
  undoBytes: number;
  undoUniqueBytes: number;
  undoEntries: number;
  undoBreakdown: UndoBreakdown[];
  layerCount: number;
  densePixelTotal: number;
  layerDetails: Array<{ name: string; w: number; h: number; denseBytes: number }>;
}

async function memorySnapshot(page: Page, label: string): Promise<SnapshotResult> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  await new Promise(r => setTimeout(r, 200));
  await cdp.send('HeapProfiler.collectGarbage');

  const heap = await cdp.send('Runtime.getHeapUsage') as { usedSize: number; totalSize: number };

  const perfMemory = await page.evaluate(() => {
    const perf = performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    };
    return perf.memory
      ? { usedJSHeapSize: perf.memory.usedJSHeapSize, totalJSHeapSize: perf.memory.totalJSHeapSize }
      : null;
  });

  const wasmMem = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__wasmMemory) {
      return (w.__wasmMemory as WebAssembly.Memory).buffer.byteLength;
    }
    return 0;
  });

  const storeInfo = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          width: number;
          height: number;
          layers: Array<{ id: string; name: string; width?: number; height?: number }>;
        };
        undoStack: Array<{
          label?: string;
          kind?: string;
          gpuSnapshots?: Map<string, unknown>;
          layerPixelData?: Map<string, ImageData>;
        }>;
        redoStack: Array<{
          kind?: string;
          gpuSnapshots?: Map<string, unknown>;
        }>;
      };
    };
    const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
      get: (id: string) => ImageData | undefined;
    };
    const state = store.getState();

    // GPU snapshots now store opaque handles (numbers), not Uint8Arrays.
    // Count handles as a proxy for memory pressure.
    const seenHandles = new Set<number>();
    let totalUndoHandles = 0;
    let uniqueUndoHandles = 0;

    const undoBreakdown: Array<{
      entryIndex: number;
      label: string;
      layerCount: number;
      totalBytes: number;
      uniqueBlobs: number;
      blobSizes: number[];
    }> = [];

    const allStacks = [
      ...state.undoStack.map((e, i) => ({ entry: e, index: i, stack: 'undo' as const })),
      ...state.redoStack.map((e, i) => ({ entry: e, index: i, stack: 'redo' as const })),
    ];

    for (const { entry, index, stack } of allStacks) {
      if (!entry.gpuSnapshots) continue;
      let entryCount = 0;
      let entryUniqueCount = 0;
      const blobSizes: number[] = [];
      for (const handle of entry.gpuSnapshots.values()) {
        const h = handle as number;
        if (h === 0xFFFFFFFF) continue;
        entryCount++;
        blobSizes.push(1);
        if (!seenHandles.has(h)) {
          seenHandles.add(h);
          uniqueUndoHandles++;
          entryUniqueCount++;
        }
      }
      totalUndoHandles += entryCount;
      if (stack === 'undo') {
        undoBreakdown.push({
          entryIndex: index,
          label: entry.label ?? '?',
          layerCount: entry.gpuSnapshots.size,
          totalBytes: entryCount,
          uniqueBlobs: entryUniqueCount,
          blobSizes,
        });
      }
    }

    let gpuLayerBytes = 0;
    const layerDetails: Array<{ name: string; w: number; h: number; denseBytes: number }> = [];
    let densePixelTotal = 0;
    for (const l of state.document.layers) {
      const w = l.width ?? 0;
      const h = l.height ?? 0;
      gpuLayerBytes += w * h * 4;
      const dense = pixelData.get(l.id);
      const denseBytes = dense?.data.byteLength ?? 0;
      densePixelTotal += denseBytes;
      layerDetails.push({ name: l.name, w, h, denseBytes });
    }

    const docW = state.document.width ?? 0;
    const docH = state.document.height ?? 0;
    const systemTexBytes = docW * docH * 4 * 3;

    return {
      layerCount: state.document.layers.length,
      undoEntries: state.undoStack.length,
      redoEntries: state.redoStack.length,
      totalUndoBytes: totalUndoHandles,
      uniqueUndoBytes: uniqueUndoHandles,
      undoBreakdown,
      gpuTextureBytes: gpuLayerBytes + systemTexBytes,
      layerDetails,
      densePixelTotal,
    };
  });

  await cdp.detach();

  const perfUsed = perfMemory?.usedJSHeapSize ?? heap.usedSize;
  const perfTotal = perfMemory?.totalJSHeapSize ?? heap.totalSize;

  console.log(`\n=== ${label} ===`);
  console.log(`  JS Heap (CDP):     ${formatMB(heap.usedSize)}`);
  console.log(`  JS Heap (perf):    ${formatMB(perfUsed)}`);
  console.log(`  WASM memory:       ${formatMB(wasmMem)}`);
  console.log(`  Undo/redo:         ${storeInfo.undoEntries}+${storeInfo.redoEntries} entries`);
  console.log(`  Undo total bytes:  ${formatMB(storeInfo.totalUndoBytes)} (counting shared blobs per-entry)`);
  console.log(`  Undo UNIQUE bytes: ${formatMB(storeInfo.uniqueUndoBytes)} (actual memory footprint)`);
  console.log(`  GPU textures:      ${formatMB(storeInfo.gpuTextureBytes)}`);
  console.log(`  Dense pixel data:  ${formatMB(storeInfo.densePixelTotal)}`);
  console.log(`  Layers:`);
  for (const l of storeInfo.layerDetails) {
    const denseTag = l.denseBytes > 0 ? ` DENSE=${formatMB(l.denseBytes)}` : '';
    console.log(`    ${l.name.padEnd(20)} ${l.w}x${l.h} gpu=${formatMB(l.w * l.h * 4)}${denseTag}`);
  }
  if (storeInfo.undoBreakdown.length > 0) {
    console.log(`  Undo entries:`);
    for (const e of storeInfo.undoBreakdown) {
      const blobStr = e.blobSizes.map(b => formatMB(b)).join(', ');
      console.log(`    [${e.entryIndex}] "${e.label}" ${e.layerCount} layers, ${formatMB(e.totalBytes)} (${e.uniqueBlobs} new) [${blobStr}]`);
    }
  }

  return {
    label,
    heapUsed: heap.usedSize,
    perfUsed,
    perfTotal,
    wasmMem,
    gpuTextureBytes: storeInfo.gpuTextureBytes,
    undoBytes: storeInfo.totalUndoBytes,
    undoUniqueBytes: storeInfo.uniqueUndoBytes,
    undoEntries: storeInfo.undoEntries,
    undoBreakdown: storeInfo.undoBreakdown,
    layerCount: storeInfo.layerCount,
    densePixelTotal: storeInfo.densePixelTotal,
    layerDetails: storeInfo.layerDetails,
  };
}

test.describe('Memory: retouching session', () => {
  test('memory stays bounded during a realistic photo retouching workflow', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'CDP heap profiling requires Chromium');
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    test.skip(!existsSync(samplePath), 'sample.jpg not present');
    test.setTimeout(300_000);

    await page.goto('/');
    await waitForStore(page);

    // ------------------------------------------------------------------
    // PHASE 0: Open the large photo (4000×6000)
    // ------------------------------------------------------------------
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 4000;
      canvas.height = 6000;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#4488aa';
      ctx.fillRect(0, 0, 4000, 6000);
      ctx.fillStyle = '#cc6633';
      ctx.fillRect(500, 500, 3000, 5000);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      const mod = await import('/src/app/paste-or-open.ts');
      await mod.pasteOrOpenBlob(blob, 'sample', true);
    });

    await page.waitForFunction(
      () => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { documentReady: boolean; document: { width: number } };
        } | undefined;
        if (!store) return false;
        const s = store.getState();
        return s.documentReady && s.document.width > 0;
      },
      { timeout: 30000 },
    );
    await page.waitForTimeout(2000);

    const docSize = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { width: number; height: number } };
      };
      const d = store.getState().document;
      return { w: d.width, h: d.height };
    });
    const oneLayerRGBA8 = docSize.w * docSize.h * 4;
    const oneLayerU16 = docSize.w * docSize.h * 4 * 2;
    console.log(`\nDocument: ${docSize.w}x${docSize.h}`);
    console.log(`One layer RGBA8: ${formatMB(oneLayerRGBA8)}, RGBA u16: ${formatMB(oneLayerU16)}`);

    const s0 = await memorySnapshot(page, 'PHASE 0: Document opened');

    // ------------------------------------------------------------------
    // PHASE 1: Image adjustments — levels, curves, hue/saturation
    // ------------------------------------------------------------------
    const rootGroupId = await getRootGroupId(page);

    await addAdjustment(page, rootGroupId, 'levels');
    await page.waitForTimeout(500);
    await closeEffectsPanel(page);

    await addAdjustment(page, rootGroupId, 'curves');
    await page.waitForTimeout(500);
    await closeEffectsPanel(page);

    await addAdjustment(page, rootGroupId, 'hue-saturation', {
      hue: 10,
      saturation: 15,
      lightness: 5,
    });
    await page.waitForTimeout(500);
    await closeEffectsPanel(page);
    await page.waitForTimeout(1000);

    const s1 = await memorySnapshot(page, 'PHASE 1: After levels + curves + hue-sat');

    // ------------------------------------------------------------------
    // PHASE 2: Add a new layer with a semi-transparent gradient
    // ------------------------------------------------------------------
    const gradientLayerId = await addLayer(page);
    await setActiveLayer(page, gradientLayerId);

    await page.locator('[data-tool-id="gradient"]').click();
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setGradientSetting: (key: 'type' | 'stops', value: unknown) => void;
        };
      };
      const s = store.getState();
      s.setGradientSetting('type', 'linear');
      s.setGradientSetting('stops', [
        { position: 0, color: { r: 255, g: 200, b: 50, a: 1 } },
        { position: 0.5, color: { r: 200, g: 100, b: 150, a: 0.5 } },
        { position: 1, color: { r: 50, g: 100, b: 200, a: 0 } },
      ]);
    });

    const gradStart = await docToScreen(page, 0, 0);
    const gradEnd = await docToScreen(page, docSize.w, docSize.h);
    await page.mouse.move(gradStart.x, gradStart.y);
    await page.mouse.down();
    await page.mouse.move(gradEnd.x, gradEnd.y, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(1000);

    await page.keyboard.press('v');
    await page.waitForTimeout(500);

    const s2 = await memorySnapshot(page, 'PHASE 2: After gradient layer');

    // ------------------------------------------------------------------
    // PHASE 3: Duplicate the background layer
    // ------------------------------------------------------------------
    const bgId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; name: string }> };
        };
      };
      const bg = store.getState().document.layers.find(l => l.name === 'Background');
      return bg?.id ?? '';
    });
    expect(bgId).not.toBe('');

    await setActiveLayer(page, bgId);
    await page.locator('[aria-label="Duplicate Layer"]').click();
    await page.waitForTimeout(2000);

    const s3 = await memorySnapshot(page, 'PHASE 3: After duplicating background');

    // ------------------------------------------------------------------
    // PHASE 4: Create a group and move the duplicate into it
    // ------------------------------------------------------------------
    const dupId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addGroup: (name?: string) => void };
      };
      store.getState().addGroup('Retouching');
    });
    await page.waitForTimeout(500);

    const groupId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; name: string; type: string }> };
        };
      };
      return store.getState().document.layers.find(l => l.name === 'Retouching')?.id ?? '';
    });
    expect(groupId).not.toBe('');

    await page.evaluate(
      ({ layerId, groupId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { moveLayerToGroup: (id: string, gid: string) => void };
        };
        store.getState().moveLayerToGroup(layerId, groupId);
      },
      { layerId: dupId, groupId },
    );
    await page.waitForTimeout(1000);

    const s4 = await memorySnapshot(page, 'PHASE 4: After group with duplicate');

    // ------------------------------------------------------------------
    // PHASE 5: Add group adjustments (exposure, contrast, hue-sat)
    // ------------------------------------------------------------------
    await addAdjustment(page, groupId, 'exposure', { exposure: 15 });
    await page.waitForTimeout(300);
    await closeEffectsPanel(page);

    await addAdjustment(page, groupId, 'contrast', { contrast: 20 });
    await page.waitForTimeout(300);
    await closeEffectsPanel(page);

    await addAdjustment(page, groupId, 'hue-saturation', {
      hue: -5,
      saturation: 25,
    });
    await page.waitForTimeout(300);
    await closeEffectsPanel(page);
    await page.waitForTimeout(1000);

    const s5 = await memorySnapshot(page, 'PHASE 5: After group adjustments');

    // ------------------------------------------------------------------
    // PHASE 6: Undo/redo cycles
    // ------------------------------------------------------------------
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1000);

    const s6 = await memorySnapshot(page, 'PHASE 6: After 5 undos');

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Control+Shift+z');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1000);

    const s7 = await memorySnapshot(page, 'PHASE 7: After 5 redos');

    // ------------------------------------------------------------------
    // SUMMARY
    // ------------------------------------------------------------------
    const snapshots = [s0, s1, s2, s3, s4, s5, s6, s7];
    console.log('\n\n========================================');
    console.log('       MEMORY SUMMARY');
    console.log('========================================');
    console.log(`One layer RGBA8: ${formatMB(oneLayerRGBA8)}, u16: ${formatMB(oneLayerU16)}`);
    console.log('');
    console.log(
      'Phase'.padEnd(48)
      + 'Heap'.padEnd(12)
      + 'GPU'.padEnd(12)
      + 'Undo(ref)'.padEnd(14)
      + 'Undo(uniq)'.padEnd(14)
      + 'Dense'.padEnd(12)
      + '#Undo'.padEnd(8),
    );
    console.log('-'.repeat(110));
    for (const s of snapshots) {
      console.log(
        s.label.padEnd(48)
        + formatMB(s.perfUsed).padEnd(12)
        + formatMB(s.gpuTextureBytes).padEnd(12)
        + formatMB(s.undoBytes).padEnd(14)
        + formatMB(s.undoUniqueBytes).padEnd(14)
        + formatMB(s.densePixelTotal).padEnd(12)
        + String(s.undoEntries).padEnd(8),
      );
    }

    const peak = (field: keyof SnapshotResult) =>
      Math.max(...snapshots.map(s => s[field] as number));

    console.log('');
    console.log(`Peak JS heap:          ${formatMB(peak('perfUsed'))}`);
    console.log(`Peak undo (unique):    ${formatMB(peak('undoUniqueBytes'))}`);
    console.log(`Peak undo (ref-count): ${formatMB(peak('undoBytes'))}`);
    console.log(`Peak GPU textures:     ${formatMB(peak('gpuTextureBytes'))}`);
    console.log(`Peak dense pixel data: ${formatMB(peak('densePixelTotal'))}`);
    console.log(`Heap growth:           ${formatMB(s7.perfUsed - s0.perfUsed)}`);

    // Check snapshot blob sizes — are they u8 or u16?
    const lastEntry = s5.undoBreakdown[s5.undoBreakdown.length - 1];
    if (lastEntry) {
      const maxBlob = Math.max(...lastEntry.blobSizes);
      const isU16 = maxBlob > oneLayerRGBA8 * 1.5;
      console.log(`\nLargest undo blob: ${formatMB(maxBlob)}`);
      console.log(`Snapshot format:   ${isU16 ? 'u16 (2 bytes/channel) — DOUBLE SIZED' : 'u8 (1 byte/channel)'}`);
      if (isU16) {
        console.log(`  → Each full-frame layer snapshot costs ${formatMB(oneLayerU16)} instead of ${formatMB(oneLayerRGBA8)}`);
        console.log(`  → Switching to u8 snapshots would halve undo memory`);
      }
    }

    // ------------------------------------------------------------------
    // ASSERTIONS
    // ------------------------------------------------------------------

    // GPU snapshots are now opaque handles — undoUniqueBytes counts unique
    // handles, not bytes. With ~50 max undo entries × 3 layers, expect
    // at most ~150 unique handles.
    const peakUndoUnique = peak('undoUniqueBytes');
    expect(peakUndoUnique).toBeLessThan(500);

    // JS heap should stay under 2 GB total
    expect(peak('perfUsed')).toBeLessThan(2 * 1024 * 1024 * 1024);

    // Dense pixel data (JS-side ImageData) should be freed after GPU upload.
    // A lingering 183 MB dense buffer means a layer wasn't cleaned up.
    // Allow up to 2 full layers of dense data transiently.
    expect(peak('densePixelTotal')).toBeLessThan(oneLayerRGBA8 * 3);

    // Undo entry count should stay bounded (max 50 per history-slice.ts)
    expect(peak('undoEntries')).toBeLessThanOrEqual(50);
  });
});
