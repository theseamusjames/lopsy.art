import { test, expect, type Page } from './fixtures';
import { setToolOption, setBrushModalOption, openBrushModal, closeBrushModal } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 200, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
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
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 30) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function readCompositedStrip(
  page: Page,
  y: number,
  xStart: number,
  xEnd: number,
  step: number,
): Promise<Array<{ x: number; r: number; g: number; b: number; a: number }>> {
  return page.evaluate(
    async ({ y, xStart, xEnd, step }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn();
      if (!result) return [];

      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      if (!container) return [];
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      const samples: Array<{ x: number; r: number; g: number; b: number; a: number }> = [];
      for (let docX = xStart; docX <= xEnd; docX += step) {
        const screenX = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
        const screenY = (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
        const px = Math.round(screenX);
        const py = result.height - 1 - Math.round(screenY);
        if (px < 0 || px >= result.width || py < 0 || py >= result.height) continue;
        const idx = (py * result.width + px) * 4;
        samples.push({
          x: docX,
          r: result.pixels[idx] ?? 0,
          g: result.pixels[idx + 1] ?? 0,
          b: result.pixels[idx + 2] ?? 0,
          a: result.pixels[idx + 3] ?? 0,
        });
      }
      return samples;
    },
    { y, xStart, xEnd, step },
  );
}

async function setupBrush(page: Page, opts: { size: number; opacity: number; hardness: number }) {
  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await setToolOption(page, 'Size', opts.size);
  await setToolOption(page, 'Opacity', opts.opacity);
  await setToolOption(page, 'Hardness', opts.hardness);
  await selectBrushTab(page, 'Shape');
  await setBrushModalOption(page, 'Spacing', 0);
  await closeBrushModal(page);
  await setToolOption(page, 'Fade', 0);
  await page.evaluate(() => {
    const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void };
    };
    ts.getState().setForegroundColor({ r: 255, g: 0, b: 0, a: 1 });
  });
}

async function selectBrushTab(page: Page, tabName: string) {
  await openBrushModal(page);
  await page.locator(`[role="dialog"][aria-label="Brushes"] [role="option"]:has-text("${tabName}")`).click();
  await page.waitForTimeout(50);
}

async function setJitter(page: Page, sizeJ: number, angleJ: number, opacityJ: number) {
  await selectBrushTab(page, 'Dynamics');
  await setBrushModalOption(page, 'Size Jitter', sizeJ);
  await setBrushModalOption(page, 'Angle Jitter', angleJ);
  await setBrushModalOption(page, 'Opacity Jitter', opacityJ);
  await closeBrushModal(page);
}

async function selectTexture(page: Page, textureName: string) {
  await selectBrushTab(page, 'Texture');
  const select = page.locator('[role="dialog"][aria-label="Brushes"] select[title="Brush texture"]');
  await select.selectOption({ label: textureName });
  await page.waitForTimeout(100);
  await closeBrushModal(page);
}

async function selectTextureBlendMode(page: Page, mode: string) {
  await selectBrushTab(page, 'Texture');
  const select = page.locator('[role="dialog"][aria-label="Brushes"] select[title="Texture blend mode"]');
  await select.selectOption({ label: mode });
  await page.waitForTimeout(100);
  await closeBrushModal(page);
}

// ---------------------------------------------------------------------------
// Tests — Jitter
// ---------------------------------------------------------------------------

test.describe('Brush jitter (#346)', () => {
  test('size jitter produces varied dab sizes', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    // Use a larger brush so we can sample at the edge to detect size variation.
    // At size 40 with 80% jitter, min dab is 8px (radius 4). Sampling at
    // y_offset=16 from center: inside the full dab (radius 20) but outside
    // the min dab (radius 4). Without jitter, all samples are painted.
    // With jitter, some smaller dabs don't reach this offset → gaps.
    await setupBrush(page, { size: 40, opacity: 100, hardness: 100 });
    await setJitter(page, 0, 0, 0);
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    // Sample near the edge of the brush (y=100+16=116)
    const baselineSamples = await readCompositedStrip(page, 116, 60, 340, 3);

    await page.screenshot({ path: 'e2e/screenshots/brush-jitter-size-baseline.png' });

    // Undo and draw with size jitter at 80%
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await setJitter(page, 80, 0, 0);
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const jitterSamples = await readCompositedStrip(page, 116, 60, 340, 3);

    await page.screenshot({ path: 'e2e/screenshots/brush-jitter-size-active.png' });

    // On white bg, near the brush edge (y=116), a full-size dab covers
    // this row with red (green~0). When dabs are jittered smaller,
    // some don't reach this offset so the bg shows through (green~255).
    const baselineGreens = baselineSamples.map((s) => s.g);
    const jitterGreens = jitterSamples.map((s) => s.g);

    function variance(arr: number[]) {
      if (arr.length === 0) return 0;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
    }

    const baseVar = variance(baselineGreens);
    const jitterVar = variance(jitterGreens);

    console.log(`Size jitter — baseline green variance: ${baseVar.toFixed(1)}, jitter green variance: ${jitterVar.toFixed(1)}`);
    console.log(`  baseline green range: ${Math.min(...baselineGreens)}–${Math.max(...baselineGreens)}`);
    console.log(`  jitter green range: ${Math.min(...jitterGreens)}–${Math.max(...jitterGreens)}`);
    expect(jitterVar).toBeGreaterThan(baseVar);
  });

  test('opacity jitter produces varied transparency', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    // Use an opaque white document — red brush paints over white.
    // With opacity jitter, some dabs are dimmer so the background bleeds
    // through, making the green channel vary along the stroke.
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    // Use wide spacing so individual dabs are distinguishable
    await setupBrush(page, { size: 20, opacity: 100, hardness: 100 });
    await selectBrushTab(page, 'Shape');
    await setBrushModalOption(page, 'Spacing', 100);
    await closeBrushModal(page);

    // Baseline stroke — no jitter
    await setJitter(page, 0, 0, 0);
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const baselineSamples = await readCompositedStrip(page, 100, 60, 340, 3);

    await page.screenshot({ path: 'e2e/screenshots/brush-jitter-opacity-baseline.png' });

    // Undo and draw with opacity jitter
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await setJitter(page, 0, 0, 80);
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const jitterSamples = await readCompositedStrip(page, 100, 60, 340, 3);

    await page.screenshot({ path: 'e2e/screenshots/brush-jitter-opacity-active.png' });

    // On white bg, red brush: green channel shows how much the bg bleeds.
    // No jitter → all dabs 100% → green near 0.
    // With jitter → some dabs are dim → green varies.
    const baselineGreens = baselineSamples.map((s) => s.g);
    const jitterGreens = jitterSamples.map((s) => s.g);

    function variance(arr: number[]) {
      if (arr.length === 0) return 0;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
    }

    const baseVar = variance(baselineGreens);
    const jitterVar = variance(jitterGreens);

    console.log(`Opacity jitter — baseline green variance: ${baseVar.toFixed(1)}, jitter green variance: ${jitterVar.toFixed(1)}`);
    console.log(`  baseline green range: ${Math.min(...baselineGreens)}–${Math.max(...baselineGreens)}`);
    console.log(`  jitter green range: ${Math.min(...jitterGreens)}–${Math.max(...jitterGreens)}`);
    expect(jitterVar).toBeGreaterThan(baseVar);
  });

  test('angle jitter with custom tip produces rotated dabs', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    // Select the Slash preset (elongated brush tip where rotation is visible)
    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          presets: Array<{ id: string; name: string }>;
          setActivePreset: (id: string) => void;
        };
      };
      const s = ts.getState();
      const slash = s.presets.find((p) => p.name === 'Slash');
      if (slash) s.setActivePreset(slash.id);
    });
    await page.waitForTimeout(100);

    await setToolOption(page, 'Size', 30);
    await setToolOption(page, 'Opacity', 100);
    await page.evaluate(() => {
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void };
      };
      ts.getState().setForegroundColor({ r: 255, g: 0, b: 0, a: 1 });
    });

    // Baseline: no angle jitter
    await setJitter(page, 0, 0, 0);
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 20);

    // Sample above the center line — the Slash tip is tall and narrow,
    // so without rotation this row has consistent coverage.
    const baselineSamples = await readCompositedStrip(page, 88, 60, 340, 3);

    await page.screenshot({ path: 'e2e/screenshots/brush-jitter-angle-baseline.png' });

    // Undo and draw with angle jitter
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await setJitter(page, 0, 100, 0);
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 20);

    const jitterSamples = await readCompositedStrip(page, 88, 60, 340, 3);

    await page.screenshot({ path: 'e2e/screenshots/brush-jitter-angle-active.png' });

    // The Slash tip is a thin vertical line. Without jitter, a horizontal
    // stroke of vertical dabs should produce consistent coverage above
    // the center line. With angle jitter, some dabs rotate sideways,
    // changing the coverage pattern. We detect this via green channel
    // (white bg bleedthrough) differences.
    const baselineGreens = baselineSamples.map((s) => s.g);
    const jitterGreens = jitterSamples.map((s) => s.g);

    // The two strokes should produce different pixel patterns
    let diffCount = 0;
    const len = Math.min(baselineGreens.length, jitterGreens.length);
    for (let i = 0; i < len; i++) {
      if (Math.abs(baselineGreens[i]! - jitterGreens[i]!) > 5) {
        diffCount++;
      }
    }

    console.log(`Angle jitter — ${diffCount}/${len} samples differ between baseline and jittered`);
    // At least some samples should differ when angle jitter changes the dab orientation
    expect(diffCount).toBeGreaterThan(0);
  });

  test('no jitter when all jitter values are zero', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await setupBrush(page, { size: 20, opacity: 100, hardness: 100 });
    await setJitter(page, 0, 0, 0);

    // Draw two identical strokes — they should produce the same result
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);
    const firstSamples = await readCompositedStrip(page, 100, 80, 320, 10);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);
    const secondSamples = await readCompositedStrip(page, 100, 80, 320, 10);

    await page.screenshot({ path: 'e2e/screenshots/brush-no-jitter.png' });

    // Without jitter, both strokes produce the same output.
    // Green channel should match closely between the two runs.
    for (let i = 0; i < Math.min(firstSamples.length, secondSamples.length); i++) {
      const diff = Math.abs(firstSamples[i]!.g - secondSamples[i]!.g);
      expect(diff).toBeLessThan(30);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — Speed Size
// ---------------------------------------------------------------------------

test.describe('Brush speed size (#346)', () => {
  test('fast stroke produces thinner line than slow stroke', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await setupBrush(page, { size: 40, opacity: 100, hardness: 100 });
    await setJitter(page, 0, 0, 0);
    await selectBrushTab(page, 'Dynamics');
    await setBrushModalOption(page, 'Speed Size', 80);
    await closeBrushModal(page);

    // Slow stroke (many steps = slow mouse movement)
    await drawStroke(page, { x: 50, y: 60 }, { x: 350, y: 60 }, 60);

    // Sample near the edge of the full-size brush (y=60+16=76)
    const slowSamples = await readCompositedStrip(page, 76, 80, 320, 5);

    await page.screenshot({ path: 'e2e/screenshots/brush-speed-size-slow.png' });

    // Undo and draw a fast stroke (few steps = fast mouse movement)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await drawStroke(page, { x: 50, y: 60 }, { x: 350, y: 60 }, 3);

    const fastSamples = await readCompositedStrip(page, 76, 80, 320, 5);

    await page.screenshot({ path: 'e2e/screenshots/brush-speed-size-fast.png' });

    // Slow stroke: brush is near full size, so y=76 (16px from center)
    // is well inside the radius (20px) → painted red (green ~ 0).
    // Fast stroke: brush shrinks, so y=76 may be outside the reduced
    // radius → background white (green ~ 255).
    const slowPaintedCount = slowSamples.filter((s) => s.g < 100).length;
    const fastPaintedCount = fastSamples.filter((s) => s.g < 100).length;

    console.log(`Speed size — slow painted: ${slowPaintedCount}/${slowSamples.length}, fast painted: ${fastPaintedCount}/${fastSamples.length}`);
    // The slow stroke should have more coverage at this offset
    expect(slowPaintedCount).toBeGreaterThan(fastPaintedCount);
  });

  test('no speed effect when speed size is zero', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await setupBrush(page, { size: 40, opacity: 100, hardness: 100 });
    await setJitter(page, 0, 0, 0);
    await selectBrushTab(page, 'Dynamics');
    await setBrushModalOption(page, 'Speed Size', 0);
    await closeBrushModal(page);

    // Fast stroke — should still be full width since speed size is disabled
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 3);

    const samples = await readCompositedStrip(page, 116, 80, 320, 5);

    await page.screenshot({ path: 'e2e/screenshots/brush-speed-size-off.png' });

    // At y=116 (16px from center), full brush (radius 20) covers this row
    const paintedCount = samples.filter((s) => s.g < 100).length;
    console.log(`Speed size off — painted: ${paintedCount}/${samples.length}`);
    expect(paintedCount).toBeGreaterThan(samples.length * 0.5);
  });
});

// ---------------------------------------------------------------------------
// Tests — Texture
// ---------------------------------------------------------------------------

test.describe('Brush texture (#346)', () => {
  test.fixme('texture modulates brush stroke', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    // Opaque white doc — red brush on white. Texture modulates the brush
    // alpha so the white bg bleeds through in a pattern, visible in green channel.
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await setupBrush(page, { size: 30, opacity: 100, hardness: 100 });
    await setJitter(page, 0, 0, 0);

    // Baseline: no texture
    await selectTexture(page, 'No Texture');
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const baselineSamples = await readCompositedStrip(page, 100, 60, 340, 3);

    await page.screenshot({ path: 'e2e/screenshots/brush-texture-baseline.png' });

    // Undo and draw with Noise texture
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await selectTexture(page, 'Noise');
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const textureSamples = await readCompositedStrip(page, 100, 60, 340, 3);

    await page.screenshot({ path: 'e2e/screenshots/brush-texture-noise.png' });

    // Red on white: green channel shows background bleedthrough.
    // Without texture: green ~ 0 (full red coverage).
    // With noise texture: green varies (texture modulates alpha).
    const baselineGreens = baselineSamples.map((s) => s.g);
    const textureGreens = textureSamples.map((s) => s.g);

    function variance(arr: number[]) {
      if (arr.length === 0) return 0;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
    }

    const baseVar = variance(baselineGreens);
    const texVar = variance(textureGreens);

    console.log(`Texture — baseline green variance: ${baseVar.toFixed(1)}, texture green variance: ${texVar.toFixed(1)}`);
    console.log(`  baseline green range: ${Math.min(...baselineGreens)}–${Math.max(...baselineGreens)}`);
    console.log(`  texture green range: ${Math.min(...textureGreens)}–${Math.max(...textureGreens)}`);
    expect(texVar).toBeGreaterThan(baseVar);
  });

  test.fixme('subtract blend mode inverts texture effect', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await setupBrush(page, { size: 30, opacity: 100, hardness: 100 });
    await setJitter(page, 0, 0, 0);

    // Draw with Noise texture in Multiply mode
    await selectTexture(page, 'Noise');
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const multiplySamples = await readCompositedStrip(page, 100, 80, 320, 5);

    await page.screenshot({ path: 'e2e/screenshots/brush-texture-multiply.png' });

    // Undo and draw with Subtract mode
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await selectTextureBlendMode(page, 'Subtract');
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const subtractSamples = await readCompositedStrip(page, 100, 80, 320, 5);

    await page.screenshot({ path: 'e2e/screenshots/brush-texture-subtract.png' });

    // Green channel shows bg bleedthrough. Multiply and subtract invert
    // the texture's effect, producing different green patterns.
    let diffCount = 0;
    const len = Math.min(multiplySamples.length, subtractSamples.length);
    for (let i = 0; i < len; i++) {
      if (Math.abs(multiplySamples[i]!.g - subtractSamples[i]!.g) > 10) {
        diffCount++;
      }
    }
    console.log(`Subtract vs Multiply — ${diffCount}/${len} samples differ by >10 in green channel`);
    // At least 20% of samples should differ noticeably between the two modes
    expect(diffCount / len).toBeGreaterThan(0.2);
  });

  test.fixme('texture scale changes tiling frequency', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await setupBrush(page, { size: 30, opacity: 100, hardness: 100 });
    await setJitter(page, 0, 0, 0);

    // Draw with Noise texture at 50% scale (smaller tiles, more oscillation)
    await selectBrushTab(page, 'Texture');
    const texSelect = page.locator('[role="dialog"][aria-label="Brushes"] select[title="Brush texture"]');
    await texSelect.selectOption({ label: 'Noise' });
    await setBrushModalOption(page, 'Scale', 50);
    await closeBrushModal(page);
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const smallScaleSamples = await readCompositedStrip(page, 100, 80, 320, 2);

    await page.screenshot({ path: 'e2e/screenshots/brush-texture-scale-50.png' });

    // Undo and draw with 200% scale (larger tiles, less oscillation)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await selectBrushTab(page, 'Texture');
    await setBrushModalOption(page, 'Scale', 200);
    await closeBrushModal(page);
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const largeScaleSamples = await readCompositedStrip(page, 100, 80, 320, 2);

    await page.screenshot({ path: 'e2e/screenshots/brush-texture-scale-200.png' });

    // Count direction changes in the green channel (bg bleedthrough pattern).
    // Smaller texture scale = more texture tiles = more oscillation.
    function countDirectionChanges(arr: number[]) {
      let changes = 0;
      for (let i = 1; i < arr.length - 1; i++) {
        const prev = arr[i - 1]!;
        const curr = arr[i]!;
        const next = arr[i + 1]!;
        if ((curr > prev && curr > next) || (curr < prev && curr < next)) {
          changes++;
        }
      }
      return changes;
    }

    const smallChanges = countDirectionChanges(smallScaleSamples.map((s) => s.g));
    const largeChanges = countDirectionChanges(largeScaleSamples.map((s) => s.g));

    console.log(`Texture scale — small scale direction changes: ${smallChanges}, large scale: ${largeChanges}`);
    expect(smallChanges).toBeGreaterThan(largeChanges);
  });

  test('no texture when set to None', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await setupBrush(page, { size: 20, opacity: 100, hardness: 100 });
    await setJitter(page, 0, 0, 0);
    await selectTexture(page, 'No Texture');

    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 40);

    const samples = await readCompositedStrip(page, 100, 80, 320, 5);

    await page.screenshot({ path: 'e2e/screenshots/brush-no-texture.png' });

    // Without texture, all painted samples should be solid red on white bg.
    // Green channel near 0 = full red coverage, no bg bleedthrough.
    const paintedSamples = samples.filter((s) => s.r > 100);
    expect(paintedSamples.length).toBeGreaterThan(0);

    for (const s of paintedSamples) {
      expect(s.g).toBeLessThan(50);
    }
  });
});
