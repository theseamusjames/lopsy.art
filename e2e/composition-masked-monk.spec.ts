import { test, expect } from '@playwright/test';
import * as flow from './composition-masked-monk.flow.ts';
import { contentBounds, layerIdByName } from './composition-cosmic-xray.steps.ts';

// "Rise of the Masked Monk": a photo-collage movie poster built entirely
// through the editor UI (see e2e/GUIDE.md) from three photos in
// e2e/fixtures/masked-monk. It doubles as the capture script for
// tutorials/raccoon-kung-fu-monk-movie-poster. Screenshots land in
// e2e/screenshots with a masked-monk- prefix.
//
// SwiftShader renders every layer effect on the CPU, so the full build takes
// most of an hour headless.

async function opaqueCount(page: import('@playwright/test').Page, name: string): Promise<number> {
  const id = await layerIdByName(page, name);
  return page.evaluate(async (id) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as (id: string) => Promise<{ pixels: number[] }>;
    const r = await fn(id);
    let n = 0;
    for (let i = 3; i < r.pixels.length; i += 4) if (r.pixels[i]! > 100) n++;
    return n;
  }, id);
}

async function alphaAt(page: import('@playwright/test').Page, name: string, x: number, y: number): Promise<number> {
  const id = await layerIdByName(page, name);
  return page.evaluate(async ({ id, x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const l = store.getState().document.layers.find((q) => q.id === id)!;
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await fn(id);
    const lx = x - l.x, ly = y - l.y;
    if (lx < 0 || ly < 0 || lx >= r.width || ly >= r.height) return 0;
    return r.pixels[(ly * r.width + lx) * 4 + 3]!;
  }, { id, x, y });
}

test.describe('composition: Rise of the Masked Monk poster', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('builds the collage through the UI', async ({ page }) => {
    test.setTimeout(3 * 60 * 60 * 1000);

    await flow.s01(page);
    await flow.s02(page);
    await flow.s03(page);
    // The temple overfills the 1200 x 1600 canvas at 1.5x its fitted size,
    // with the courtyard's front edge near the bottom of the poster.
    const temple = (await contentBounds(page, 'Temple'))!;
    expect(temple.x0).toBeLessThan(-230);
    expect(temple.x1).toBeGreaterThan(1540);
    expect(temple.y0).toBeLessThan(0);
    expect(temple.y1).toBeGreaterThan(2100);

    await flow.s04(page);
    await flow.s05(page);
    // The lasso cut leaves only the fighter: well under half the 1062 x 1600
    // photo stays opaque, and the backdrop corner is gone.
    expect(await opaqueCount(page, 'Fighter')).toBeLessThan(1062 * 1600 * 0.3);
    expect(await alphaAt(page, 'Fighter', 40, 1500)).toBe(0);
    expect(await alphaAt(page, 'Fighter', 560, 1000)).toBe(255);

    await flow.s06(page);
    // Scaled to 85 % about the feet: the planted shoe ends on the hall steps
    // at FEET_Y, the fighter's own face is cleared, and the jar remains.
    const fighter = (await contentBounds(page, 'Fighter'))!;
    expect(Math.abs(fighter.y1 - flow.FEET_Y)).toBeLessThanOrEqual(4);
    expect(fighter.y1 - fighter.y0).toBeGreaterThan(1298 * 0.8);
    expect(fighter.y1 - fighter.y0).toBeLessThan(1298 * 0.9);
    const face = flow.fig({ x: 610, y: 400 });
    const jar = flow.fig({ x: 408, y: 420 });
    expect(await alphaAt(page, 'Fighter', Math.round(face.x), Math.round(face.y))).toBe(0);
    expect(await alphaAt(page, 'Fighter', Math.round(jar.x), Math.round(jar.y))).toBe(255);

    await flow.s07(page);
    await flow.s08(page);
    // The raccoon head is scaled to ~44 % and centred low enough on the
    // collar that the chin overlaps it.
    const head = (await contentBounds(page, 'Raccoon'))!;
    expect(head.x1 - head.x0).toBeGreaterThan(215);
    expect(head.x1 - head.x0).toBeLessThan(255);
    expect(Math.abs((head.x0 + head.x1) / 2 - flow.NECK.x)).toBeLessThan(3);
    expect(head.y1).toBeGreaterThan(flow.fig({ x: 606, y: 530 }).y);

    await flow.s09(page);
    await flow.s10(page);
    await flow.s11(page);
    await flow.s11b(page);
    await flow.s12(page);
    await flow.s13(page);
    await flow.s14(page);
    await flow.s15(page);
    await flow.s16(page);
    await flow.s16b(page);
    // The title is centred on the poster.
    const title = (await contentBounds(page, 'MASKED MONK'))!;
    expect(Math.abs((title.x0 + title.x1) / 2 - 600)).toBeLessThanOrEqual(2);

    await flow.s17(page);
    await flow.s18(page);
    const png = await flow.s19(page);
    // PNG IHDR: width and height are big-endian u32s at bytes 16 and 20.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(1600);
    if (process.env.MONK_EXPORT) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.MONK_EXPORT, png);
    }
  });
});
