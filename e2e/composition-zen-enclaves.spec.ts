import { test, expect } from '@playwright/test';
import * as flow from './composition-zen-enclaves.flow.ts';
import { contentBounds } from './composition-zen-enclaves.steps.ts';

// "Zen Enclaves": an isometric tattoo flash sheet of four floating zen
// islands, built entirely through the editor UI (see e2e/GUIDE.md). It
// doubles as the capture script for tutorials/isometric-zen-tattoo-flash.
// Screenshots land in e2e/screenshots with a zen-enclaves- prefix.
//
// SwiftShader renders every layer effect on the CPU, so the full build takes
// well over an hour headless; effects are baked as each design is lined.

test.describe('composition: Zen Enclaves isometric tattoo flash sheet', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('builds the sheet through the UI', async ({ page }) => {
    test.setTimeout(4 * 60 * 60 * 1000);

    for (const step of [flow.s01, flow.s02, flow.s03, flow.s03b, flow.s04, flow.s05, flow.s06, flow.s07]) await step(page);

    // The title's glyph box is centred on the plate face.
    const title = await flow.s08(page) as { x0: number; y0: number; x1: number; y1: number };
    const p = flow.PLATE;
    expect(Math.abs((title.x0 - p.x0) - (p.x1 - title.x1))).toBeLessThanOrEqual(2);
    expect(Math.abs((title.y0 - p.y0) - (p.y1 - title.y1))).toBeLessThanOrEqual(2);

    for (const step of [flow.s09, flow.s10, flow.s12, flow.s13, flow.s14, flow.s15, flow.s16, flow.s17, flow.s18, flow.s19, flow.s20]) await step(page);

    // Rotating the pasted koi through the handle turns it, it doesn't just move it.
    const koi = await flow.s21(page) as { before: { y0: number; y1: number }; after: { y0: number; y1: number } };
    expect(koi.after.y1 - koi.after.y0).toBeGreaterThan((koi.before.y1 - koi.before.y0) * 1.3);

    for (const step of [flow.s22, flow.s23, flow.s24, flow.s25, flow.s26, flow.s27]) await step(page);

    // The pasted cloud shrank by a quarter under the uniform corner scale.
    const cloud = await flow.s28(page) as { cloud2: { x0: number; x1: number }; before: { x0: number; x1: number } };
    const ratio = (cloud.cloud2.x1 - cloud.cloud2.x0) / (cloud.before.x1 - cloud.before.x0);
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.85);

    await flow.s29(page);
    await flow.s30(page);

    // Group + multi-layer move with snap, then undo x3 / redo x3 returns the
    // moved layers to byte-identical pixels and positions.
    const history = await flow.s34(page) as { before: string; hashes: string[]; afterRedo: string; match: boolean };
    expect(history.hashes[0]).not.toBe(history.before);
    expect(history.hashes[1]).toBe(history.before);
    expect(history.match).toBe(true);

    // Four badges, four centred numbers.
    const numbers = await flow.s31(page) as Array<{ x0: number; y0: number; x1: number; y1: number }>;
    numbers.forEach((b, i) => {
      expect(Math.abs((b.x0 + b.x1) / 2 - flow.BADGES[i]!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs((b.y0 + b.y1) / 2 - flow.BADGES[i]!.y)).toBeLessThanOrEqual(1);
    });

    const footer = await flow.s32(page) as { footer: { x0: number; x1: number } };
    expect(Math.abs((footer.footer.x0 + footer.footer.x1) / 2 - 600)).toBeLessThanOrEqual(1);

    await flow.s33(page);
    await flow.s35(page);
    await flow.s36(page);
    await flow.s37(page);

    const state = await flow.layers(page) as { layers: string[] };
    expect(state.layers.length).toBeGreaterThanOrEqual(40);
    expect(await contentBounds(page, 'Paper Grain')).not.toBeNull();
  });
});
