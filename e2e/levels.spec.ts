import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, paintRect } from './helpers';

interface PixelSnap {
  width: number;
  height: number;
  pixels: number[];
}

async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<PixelSnap | null>;
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

interface LevelsChannelJSON {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

interface LevelsJSON {
  rgb: LevelsChannelJSON;
  r: LevelsChannelJSON;
  g: LevelsChannelJSON;
  b: LevelsChannelJSON;
}

const IDENTITY: LevelsChannelJSON = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };

async function setGroupLevels(page: Page, levels: LevelsJSON): Promise<void> {
  await page.evaluate(({ l }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { rootGroupId: string };
        setGroupAdjustments: (id: string, adj: Record<string, unknown>) => void;
        setGroupAdjustmentsEnabled: (id: string, enabled: boolean) => void;
      };
    };
    const state = store.getState();
    const groupId = state.document.rootGroupId;
    state.setGroupAdjustmentsEnabled(groupId, true);
    state.setGroupAdjustments(groupId, {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      whites: 0, blacks: 0, vignette: 0, saturation: 0, vibrance: 0,
      levels: l,
    });
  }, { l: levels });
}

async function paintHorizontalGradient(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        updateLayerPixelData: (id: string, data: ImageData) => void;
      };
    };
    const state = store.getState();
    const data = new ImageData(state.document.width, state.document.height);
    for (let y = 0; y < state.document.height; y++) {
      for (let x = 0; x < state.document.width; x++) {
        const v = Math.round((x / (state.document.width - 1)) * 255);
        const idx = (y * state.document.width + x) * 4;
        data.data[idx] = v;
        data.data[idx + 1] = v;
        data.data[idx + 2] = v;
        data.data[idx + 3] = 255;
      }
    }
    store.getState().updateLayerPixelData(state.document.activeLayerId, data);
  });
}

test.describe('Levels adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(300);
  });

  test('master Levels crushes below inBlack and lifts above inWhite', async ({ page }) => {
    await paintHorizontalGradient(page);
    await page.waitForTimeout(300);

    // Before: a linear black → white gradient.
    await page.screenshot({ path: 'test-results/screenshots/levels-gradient-before.png' });

    const beforeQuarter = await readCompositedAtDoc(page, 25, 50);   // input ≈ 64
    const beforeThreeQ = await readCompositedAtDoc(page, 75, 50);    // input ≈ 191
    expect(beforeQuarter.r).toBeGreaterThan(40);
    expect(beforeQuarter.r).toBeLessThan(90);
    expect(beforeThreeQ.r).toBeGreaterThan(170);
    expect(beforeThreeQ.r).toBeLessThan(220);

    // Classic levels contrast boost: clip the bottom 80 tones to black and
    // the top 80 tones to white, leaving the mid band stretched out.
    await setGroupLevels(page, {
      rgb: { inBlack: 80, inWhite: 175, gamma: 1, outBlack: 0, outWhite: 255 },
      r: IDENTITY,
      g: IDENTITY,
      b: IDENTITY,
    });
    await page.waitForTimeout(250);

    await page.screenshot({ path: 'test-results/screenshots/levels-gradient-contrast.png' });

    const afterQuarter = await readCompositedAtDoc(page, 25, 50);
    const afterMid = await readCompositedAtDoc(page, 50, 50);
    const afterThreeQ = await readCompositedAtDoc(page, 75, 50);

    // Below inBlack (64 < 80) → crushed to 0.
    expect(afterQuarter.r, 'quarter-tone should be crushed to black').toBeLessThan(20);
    // Above inWhite (191 > 175) → blown to 255.
    expect(afterThreeQ.r, 'three-quarter-tone should be lifted to white').toBeGreaterThan(235);
    // Midpoint (128) falls inside [80, 175] and remaps to (128-80)/(175-80) ≈ 0.505 → ~129.
    expect(afterMid.r).toBeGreaterThan(100);
    expect(afterMid.r).toBeLessThan(160);
  });

  test('gamma > 1 brightens midtones without touching the endpoints', async ({ page }) => {
    await paintRect(page, 0, 0, 100, 100, { r: 128, g: 128, b: 128, a: 255 });
    await page.waitForTimeout(200);

    const before = await readCompositedAtDoc(page, 50, 50);
    expect(before.r).toBeGreaterThan(120);
    expect(before.r).toBeLessThan(140);

    await setGroupLevels(page, {
      rgb: { inBlack: 0, inWhite: 255, gamma: 2.2, outBlack: 0, outWhite: 255 },
      r: IDENTITY,
      g: IDENTITY,
      b: IDENTITY,
    });
    await page.waitForTimeout(200);

    const after = await readCompositedAtDoc(page, 50, 50);
    // gamma 2.2: pow(128/255, 1/2.2) * 255 ≈ pow(0.502, 0.4545) * 255 ≈ 186
    expect(after.r, 'mid-gray should lift with gamma 2.2').toBeGreaterThan(170);
    expect(after.r).toBeLessThan(200);
  });

  test('per-channel Levels only affects the targeted channel', async ({ page }) => {
    // Solid warm colour: red high, green mid, blue low — so a red-only
    // remap has something to do on each channel probe.
    await paintRect(page, 0, 0, 100, 100, { r: 200, g: 120, b: 60, a: 255 });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'test-results/screenshots/levels-per-channel-before.png' });

    // Crush red to black (outWhite=0), leave green / blue identity.
    await setGroupLevels(page, {
      rgb: IDENTITY,
      r: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 0 },
      g: IDENTITY,
      b: IDENTITY,
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'test-results/screenshots/levels-per-channel-after.png' });

    const px = await readCompositedAtDoc(page, 50, 50);
    expect(px.r, 'red channel crushed to 0').toBeLessThan(10);
    expect(px.g, 'green channel unchanged').toBeGreaterThan(100);
    expect(px.g).toBeLessThan(140);
    expect(px.b, 'blue channel unchanged').toBeGreaterThan(45);
    expect(px.b).toBeLessThan(80);
  });

  test('output range compresses the image into a narrower tonal band', async ({ page }) => {
    await paintHorizontalGradient(page);
    await page.waitForTimeout(200);

    await setGroupLevels(page, {
      rgb: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 64, outWhite: 192 },
      r: IDENTITY,
      g: IDENTITY,
      b: IDENTITY,
    });
    await page.waitForTimeout(200);

    const leftEnd = await readCompositedAtDoc(page, 1, 50);
    const rightEnd = await readCompositedAtDoc(page, 99, 50);
    // Pure black lifts to ~64; pure white drops to ~192.
    expect(leftEnd.r, 'black lifts to output black ≈ 64').toBeGreaterThan(50);
    expect(leftEnd.r).toBeLessThan(80);
    expect(rightEnd.r, 'white drops to output white ≈ 192').toBeGreaterThan(180);
    expect(rightEnd.r).toBeLessThan(205);
  });

  test('resetting to identity levels restores original pixels', async ({ page }) => {
    await paintRect(page, 0, 0, 100, 100, { r: 100, g: 100, b: 100, a: 255 });
    await page.waitForTimeout(200);

    // Strong adjustment first.
    await setGroupLevels(page, {
      rgb: { inBlack: 50, inWhite: 200, gamma: 0.5, outBlack: 0, outWhite: 255 },
      r: IDENTITY,
      g: IDENTITY,
      b: IDENTITY,
    });
    await page.waitForTimeout(150);

    // Back to identity — pixels should snap back to ~100.
    await setGroupLevels(page, {
      rgb: IDENTITY,
      r: IDENTITY,
      g: IDENTITY,
      b: IDENTITY,
    });
    await page.waitForTimeout(200);

    const px = await readCompositedAtDoc(page, 50, 50);
    expect(px.r).toBeGreaterThan(95);
    expect(px.r).toBeLessThan(110);
  });
});
