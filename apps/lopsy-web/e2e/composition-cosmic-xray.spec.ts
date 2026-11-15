import { test, expect } from '@playwright/test';
import * as flow from './composition-cosmic-xray.flow.ts';
import { contentBounds, layerBounds } from './composition-cosmic-xray.steps.ts';

// "Cosmic X-Ray": a holographic tattoo flash sheet built entirely through the
// editor UI (see e2e/GUIDE.md). It doubles as the capture script for
// tutorials/cosmic-xray-tattoo-flash. Screenshots land in e2e/screenshots
// with a cosmic-xray- prefix.
//
// SwiftShader renders every layer effect on the CPU, so the full build takes
// well over an hour headless; effects are baked (Rasterize Layer Style) as
// each design is finished to keep frame times down.

test.describe('composition: Cosmic X-Ray tattoo flash sheet', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('builds the sheet through the UI', async ({ page }) => {
    test.setTimeout(4 * 60 * 60 * 1000);

    await flow.s01(page);
    await flow.s02(page);
    await flow.s03(page);
    await flow.s04(page);
    await flow.s05(page);
    await flow.s06(page);
    await flow.s07(page);
    await flow.s08(page);
    await flow.s09(page);

    // The title is seated in the 170..1030 x 92..218 banner with even margins.
    const title = await flow.s10(page) as { x0: number; y0: number; x1: number; y1: number };
    expect(Math.abs((title.x0 - 170) - (1030 - title.x1))).toBeLessThanOrEqual(2);
    expect(Math.abs((title.y0 - 92) - (218 - title.y1))).toBeLessThanOrEqual(2);
    expect(title.y0 - 92).toBeGreaterThan(15);

    await flow.s11(page);
    await flow.s12(page);
    await flow.s13(page);
    await flow.s13b(page);
    await flow.s14(page);
    await flow.s15(page);
    await flow.s16(page);

    // Rotating the crescent through the transform handles keeps its pixels.
    const moon = await flow.s17(page) as { before: { x0: number; x1: number }; after: { x0: number; x1: number } };
    expect(moon.after.x1 - moon.after.x0).toBeGreaterThan((moon.before.x1 - moon.before.x0) * 0.8);

    await flow.s18(page);
    await flow.s19(page);
    await flow.s20(page);
    await flow.s21(page);
    await flow.s22(page);

    // The ring's back arc is erased only where it passes behind the planet,
    // so the ring still spans well past both sides of the 236 px disc.
    const ring = await flow.s23(page) as { x0: number; x1: number };
    expect(ring.x1 - ring.x0).toBeGreaterThan(380);

    // Four badges, four centred numbers.
    const numbers = await flow.s24(page) as Array<{ x0: number; y0: number; x1: number; y1: number }>;
    numbers.forEach((b, i) => {
      expect(Math.abs((b.x0 + b.x1) / 2 - flow.BADGES[i]!.x)).toBeLessThanOrEqual(1);
    });

    await flow.s25(page);
    // The footer line is centred on its ribbon plate (330..870 x 1420..1482).
    const footer = await flow.s26(page) as { x0: number; y0: number; x1: number; y1: number };
    expect(Math.abs((footer.x0 + footer.x1) / 2 - 600)).toBeLessThanOrEqual(1);
    expect(footer.y0).toBeGreaterThan(1420);
    expect(footer.y1).toBeLessThan(1482);

    // Group + multi-layer move with snap, then undo x3 / redo x3 returns the
    // moved layers to byte-identical pixels and positions.
    const history = await flow.s27(page) as { before: string; hashes: string[]; afterRedo: string; match: boolean };
    expect(history.hashes[0]).not.toBe(history.before);
    expect(history.hashes[1]).toBe(history.before);
    expect(history.match).toBe(true);

    await flow.s28(page);
    await flow.s29(page);

    const state = await flow.layers(page) as { layers: string[] };
    expect(state.layers.length).toBeGreaterThanOrEqual(30);
    const banner = await contentBounds(page, 'Banner');
    expect(banner).not.toBeNull();
    expect((await layerBounds(page, 'Grain')).width).toBeGreaterThan(0);
  });
});
