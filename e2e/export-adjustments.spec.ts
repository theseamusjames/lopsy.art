import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument, paintRect } from './helpers';

// PNG magic bytes: 137 80 78 71 13 10 26 10
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface PixelSnap {
  width: number;
  height: number;
  pixels: number[];
}

async function readComposited(page: Page): Promise<PixelSnap | null> {
  return page.evaluate(() =>
    (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnap | null>,
  );
}

/**
 * Read a single composited screen pixel at the given doc coordinate.
 * The composited buffer is bottom-up (from gl.readPixels), so we flip y.
 */
async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const sx = Math.round(
      (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2,
    );
    const sy = Math.round(
      (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const flippedY = result.height - 1 - sy;
    const idx = (flippedY * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

async function setGroupAdjustments(
  page: Page,
  saturation: number,
  vibrance: number,
): Promise<void> {
  await page.evaluate(({ s, v }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { rootGroupId: string };
        setGroupAdjustments: (id: string, adj: Record<string, number>) => void;
        setGroupAdjustmentsEnabled: (id: string, enabled: boolean) => void;
      };
    };
    const state = store.getState();
    const groupId = state.document.rootGroupId;
    state.setGroupAdjustmentsEnabled(groupId, true);
    state.setGroupAdjustments(groupId, {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      vignette: 0,
      saturation: s,
      vibrance: v,
    });
  }, { s: saturation, v: vibrance });
}

test.describe('Export pipeline applies saturation & vibrance (#122)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(300);
  });

  test('group saturation desaturates the live composite via the GPU shader', async ({ page }) => {
    // Paint a partially-saturated red (255, 80, 80). With the maximum
    // negative saturation the GPU shader (gpu/shaders/filters/adjustments.glsl)
    // mixes the colour with its luma value, collapsing R/G/B toward gray.
    //
    // The AdjustmentsPanel slider produces values in -100..100 (see
    // src/panels/AdjustmentsPanel/AdjustmentsPanel.tsx). The GPU compositor
    // divides by 100 internally, so -100 → full desaturation in the shader.
    await paintRect(page, 20, 20, 60, 60, { r: 255, g: 80, b: 80, a: 255 });
    await page.waitForTimeout(200);

    const before = await readCompositedAtDoc(page, 50, 50);
    expect(before.r).toBeGreaterThan(200);
    expect(before.g).toBeLessThan(120);
    expect(before.b).toBeLessThan(120);

    // Use the slider's full range — -100 → -1 in the shader after the
    // engine's /100 normalisation, which produces the gray-equivalent.
    await setGroupAdjustments(page, -100, 0);
    await page.waitForTimeout(200);

    const after = await readCompositedAtDoc(page, 50, 50);
    // The channel spread must shrink dramatically — gray equivalent is
    // luma ≈ 110, so R drops from 255 → ~110, G/B rise from 80 → ~110.
    const beforeSpread = Math.max(before.r, before.g, before.b) - Math.min(before.r, before.g, before.b);
    const afterSpread = Math.max(after.r, after.g, after.b) - Math.min(after.r, after.g, after.b);
    expect(afterSpread).toBeLessThan(beforeSpread / 4);
    // R must drop substantially.
    expect(after.r).toBeLessThan(before.r - 30);
    // G must rise (it was the least-saturated channel; pulls toward luma).
    expect(after.g).toBeGreaterThan(before.g + 20);

    // The adjustments must persist on the group layer in the store.
    const stored = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { rootGroupId: string; layers: Array<Record<string, unknown>> } };
      };
      const state = store.getState();
      const group = state.document.layers.find((l) => l.id === state.document.rootGroupId);
      return group?.adjustments as Record<string, number> | undefined;
    });
    expect(stored?.saturation).toBe(-100);
  });

  test('PNG export reflects active group adjustments', async ({ page }) => {
    // Paint a partially-saturated red so adjustments have a visible effect.
    await paintRect(page, 20, 20, 60, 60, { r: 255, g: 80, b: 80, a: 255 });
    await page.waitForTimeout(200);

    // First export — no adjustments — to capture a baseline pixel value.
    const baselinePixel = await exportAndDecodePixel(page, 50, 50);
    expect(baselinePixel).not.toBeNull();
    // The baseline must contain the painted red.
    expect(baselinePixel!.r).toBeGreaterThan(200);
    expect(baselinePixel!.g).toBeLessThan(120);

    // Apply a meaningful negative-saturation adjustment via the slider's
    // own units (-100..100). The aggregateGroupAdjustments path picks this
    // up from the rootGroup and the export pipeline runs the JS LUT
    // (applyAdjustmentsToImageData) over it. The exact post-export pixel
    // depends on the JS desaturation math; we only require that the export
    // CHANGED the painted region — not what it changed to.
    await setGroupAdjustments(page, -100, 0);
    await page.waitForTimeout(200);

    const adjustedPixel = await exportAndDecodePixel(page, 50, 50);
    expect(adjustedPixel).not.toBeNull();

    // The adjusted export must differ from the baseline in at least one
    // RGB channel by a meaningful amount. Pure-image-equal would mean the
    // export pipeline ignored the adjustment.
    const dr = Math.abs(baselinePixel!.r! - adjustedPixel!.r!);
    const dg = Math.abs(baselinePixel!.g! - adjustedPixel!.g!);
    const db = Math.abs(baselinePixel!.b! - adjustedPixel!.b!);
    expect(dr + dg + db).toBeGreaterThan(50);
  });

  test('live composite and PNG export agree on the same saturation value', async ({ page }) => {
    // Regression test for the JS saturation/vibrance unit-mismatch fix
    // (src/filters/image-adjustments.ts). Before the fix, the GPU shader
    // divided saturation by 100 but the JS export pipeline did not, so
    // the same slider value produced wildly different results on screen
    // vs in the exported PNG. A user who saw a nicely desaturated live
    // preview would get a totally crushed (or unchanged) PNG file.
    //
    // Paint a partially-saturated red and apply a slider-mid-range
    // negative saturation. Both the live composite and the exported PNG
    // should show the painted region desaturated to roughly the same
    // gray value.
    await paintRect(page, 20, 20, 60, 60, { r: 255, g: 80, b: 80, a: 255 });
    await page.waitForTimeout(200);

    await setGroupAdjustments(page, -100, 0);
    await page.waitForTimeout(200);

    const live = await readCompositedAtDoc(page, 50, 50);
    const exported = await exportAndDecodePixel(page, 50, 50);
    expect(exported).not.toBeNull();

    // Both paths must desaturate the same input to roughly the same
    // output. We allow a small per-channel tolerance to accommodate
    // rounding differences between the GPU float pipeline and the JS
    // integer pipeline (gl.readPixels and the PNG decoder each clamp
    // to u8 at different points).
    expect(Math.abs(live.r - exported!.r!)).toBeLessThanOrEqual(8);
    expect(Math.abs(live.g - exported!.g!)).toBeLessThanOrEqual(8);
    expect(Math.abs(live.b - exported!.b!)).toBeLessThanOrEqual(8);

    // And both paths must actually have desaturated: the R/G/B spread
    // must have shrunk from the original (175) to under a third of that.
    const liveSpread = Math.max(live.r, live.g, live.b) - Math.min(live.r, live.g, live.b);
    const exportedSpread = Math.max(exported!.r!, exported!.g!, exported!.b!) - Math.min(exported!.r!, exported!.g!, exported!.b!);
    expect(liveSpread).toBeLessThan(60);
    expect(exportedSpread).toBeLessThan(60);
  });
});

/**
 * Trigger PNG export from the File menu, decode the resulting PNG via the
 * browser, and return the RGBA at the requested pixel. Returns null if
 * the export or decode fails.
 */
async function exportAndDecodePixel(
  page: Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number } | null> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Export PNG' }).click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  if (stream) {
    for await (const chunk of stream) chunks.push(chunk as Buffer);
  }
  const pngBuffer = Buffer.concat(chunks);
  if (pngBuffer.length === 0) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (pngBuffer[i] !== PNG_MAGIC[i]) return null;
  }

  return page.evaluate(async ({ bytes, px, py }) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(px, py, 1, 1).data;
      return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, { bytes: Array.from(pngBuffer), px: x, py: y });
}
