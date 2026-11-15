import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  selectTool,
  openBrushModal,
  closeBrushModal,
  setBrushModalOption,
  setForegroundColor,
} from './helpers';

const DOC_W = 1000;
const DOC_H = 800;

/** Doc-space alpha mask of the active layer (1 = alpha > 128). */
async function readActiveLayerMask(page: Page): Promise<Uint8Array> {
  const flat = await page.evaluate(async ({ w, h }) => {
    const win = window as unknown as Record<string, unknown>;
    const editor = win.__editorStore as {
      getState: () => {
        pushHistory: (label: string) => void;
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    // Flushes the pending GPU stroke into the layer texture.
    editor.getState().pushHistory('flush');
    const doc = editor.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    const read = win.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(layer.id);
    const out = new Array<number>(w * h).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x + layer.x;
        const dy = y + layer.y;
        if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
        if (pixels[(y * width + x) * 4 + 3]! > 128) out[dy * w + dx] = 1;
      }
    }
    return out;
  }, { w: DOC_W, h: DOC_H });
  return Uint8Array.from(flat);
}

/**
 * Fraction of opaque pixels whose symmetry partner (under `partner`) is
 * opaque too. 1.0 means the painted image is exactly invariant.
 */
function partnerMatchRatio(mask: Uint8Array, partner: (x: number, y: number) => [number, number]): { ratio: number; opaque: number } {
  let opaque = 0;
  let matched = 0;
  for (let y = 0; y < DOC_H; y++) {
    for (let x = 0; x < DOC_W; x++) {
      if (!mask[y * DOC_W + x]) continue;
      opaque++;
      const [px, py] = partner(x, y);
      if (px >= 0 && py >= 0 && px < DOC_W && py < DOC_H && mask[py * DOC_W + px]) matched++;
    }
  }
  return { ratio: opaque === 0 ? 0 : matched / opaque, opaque };
}

async function setUpCalligraphicBrush(page: Page): Promise<void> {
  await selectTool(page, 'brush');
  await setForegroundColor(page, 0, 0, 0);
  await openBrushModal(page);
  const dialog = page.locator('[role="dialog"][aria-label="Brushes"]');
  await dialog.locator('[aria-label="Brush preset: Caligraphic Rounded"]').click();
  await closeBrushModal(page);
  await setBrushModalOption(page, 'Size', 80);
  await setBrushModalOption(page, 'Hardness', 100);
  await expect(page.locator('[aria-label="Brush angle"]')).toHaveAttribute('aria-valuenow', '0');
  await closeBrushModal(page);
}

async function strokeDoc(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test.describe('Brush symmetry orients the tip with each copy (#1599)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'brush modal requires the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, true);
    await page.waitForTimeout(300);
    await setUpCalligraphicBrush(page);
  });

  test('vertical mirror paints an exact mirror image of an oriented tip', async ({ page }) => {
    await page.locator('[aria-label="Symmetry Vertical"]').click();
    await strokeDoc(page, [180, 250], [300, 490]);
    await page.screenshot({ path: 'e2e/screenshots/brush-symmetry-tip-vertical.png' });

    const mask = await readActiveLayerMask(page);
    // Centre (500, 400): pixel column x mirrors to 999 - x.
    const { ratio, opaque } = partnerMatchRatio(mask, (x, y) => [DOC_W - 1 - x, y]);
    expect(opaque).toBeGreaterThan(2000);
    expect(ratio).toBeGreaterThan(0.97);
  });

  test('radial 4 paints four identically rotated strokes', async ({ page }) => {
    await page.locator('[aria-label="Radial Symmetry"]').click();
    const segments = page.locator('#radial-segments');
    await segments.fill('4');
    await segments.press('Enter');
    await strokeDoc(page, [180, 250], [300, 490]);
    await page.screenshot({ path: 'e2e/screenshots/brush-symmetry-tip-radial4.png' });

    const mask = await readActiveLayerMask(page);
    // A 90 degree turn about the pixel-centre (500, 400) sends pixel
    // (x, y) to (899 - y, x - 100).
    const { ratio, opaque } = partnerMatchRatio(mask, (x, y) => [899 - y, x - 100]);
    expect(opaque).toBeGreaterThan(4000);
    expect(ratio).toBeGreaterThan(0.97);
  });
});
