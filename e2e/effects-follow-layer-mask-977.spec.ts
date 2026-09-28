import { test, expect, type Page } from './fixtures';
import {
  addLayer, closeEffectsPanel, configureEffect, createDocument, docToScreen, selectTool,
  setEffectColor, setForegroundColor, setToolOption, waitForStore,
} from './helpers';

// #977: layer effects were built from the layer's unmasked alpha, so a
// Stroke kept outlining the part of the layer a mask hides and never traced
// the edge the mask creates.

type Rgba = { r: number; g: number; b: number; a: number };

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 10): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Composited column of RGBA values at doc x, for doc rows y0..y1. */
async function compositeColumn(page: Page, docX: number, y0: number, y1: number): Promise<Rgba[]> {
  const top = await docToScreen(page, docX, y0);
  const bottom = await docToScreen(page, docX, y1);
  return page.evaluate(async ({ sx, syTop, syBottom, rows }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const out: Array<{ r: number; g: number; b: number; a: number }> = [];
    for (let i = 0; i <= rows; i++) {
      const screenY = rows === 0 ? syTop : syTop + ((syBottom - syTop) * i) / rows;
      const x = Math.round((sx - rect.left) * scale);
      const y = comp.height - 1 - Math.round((screenY - rect.top) * scale);
      const k = (y * comp.width + x) * 4;
      out.push({ r: comp.pixels[k]!, g: comp.pixels[k + 1]!, b: comp.pixels[k + 2]!, a: comp.pixels[k + 3]! });
    }
    return out;
  }, { sx: top.x, syTop: top.y, syBottom: bottom.y, rows: y1 - y0 });
}

async function compositeAt(page: Page, docX: number, docY: number): Promise<Rgba> {
  return (await compositeColumn(page, docX, docY, docY))[0]!;
}

const isCyan = (p: Rgba): boolean => p.r < 90 && p.g > 150 && p.b > 180;
const isWhite = (p: Rgba): boolean => p.r > 230 && p.g > 230 && p.b > 230;
const isDark = (p: Rgba): boolean => p.r < 60 && p.g < 60 && p.b < 60;

test.describe('Layer effects follow the layer mask (#977)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });

  test('Stroke traces the masked silhouette, not the hidden pixels', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const layerId = await addLayer(page);
    await setForegroundColor(page, 20, 20, 20);
    await selectTool(page, 'marquee-rect');
    await dragDoc(page, 200, 100, 600, 500);
    await page.getByRole('button', { name: /^Edit$/ }).click();
    await page.getByRole('menuitem', { name: /^Fill$/ }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);

    await configureEffect(page, 'Stroke', { Width: 10 });
    await setEffectColor(page, 'Stroke color', 0, 208, 255);
    await page.locator('[aria-label="Stroke position: outside"]').click();
    await closeEffectsPanel(page);

    // Before masking: the outside stroke rings the whole square.
    expect(isCyan(await compositeAt(page, 400, 505))).toBe(true);

    // Hide everything below y ≈ 300 with a hard black mask brush.
    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 200);
    await setToolOption(page, 'Hardness', 100);
    await dragDoc(page, 100, 400, 700, 400, 8);
    await dragDoc(page, 100, 540, 700, 540, 8);
    await page.locator(`[data-layer-id="${layerId}"]`).click();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/effects-follow-layer-mask-977.png' });

    // The visible upper half is still filled and outlined on top.
    expect(isDark(await compositeAt(page, 400, 200))).toBe(true);
    expect(isCyan(await compositeAt(page, 400, 95))).toBe(true);
    expect(isCyan(await compositeAt(page, 195, 200))).toBe(true);

    // Nothing is drawn around the hidden lower half.
    expect(isWhite(await compositeAt(page, 400, 505))).toBe(true);
    expect(isWhite(await compositeAt(page, 195, 450))).toBe(true);
    expect(isWhite(await compositeAt(page, 605, 450))).toBe(true);
    expect(isWhite(await compositeAt(page, 400, 420))).toBe(true);

    // A stroke runs along the new bottom edge the mask creates: going down
    // column x=400, the dark fill gives way to cyan before turning white.
    const column = await compositeColumn(page, 400, 250, 330);
    const firstNonDark = column.findIndex((p) => !isDark(p));
    expect(firstNonDark).toBeGreaterThan(0);
    const edge = column.slice(firstNonDark, firstNonDark + 12);
    expect(edge.some(isCyan)).toBe(true);
  });
});
