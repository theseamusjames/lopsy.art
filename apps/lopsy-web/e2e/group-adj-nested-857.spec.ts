import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  drawRect,
  getRootGroupId,
  addAdjustment,
  addLayer,
  getEditorState,
  setGroupBlendMode,
} from './helpers';

/**
 * Regression test for #857: once ANY adjustment on the root "Project" group
 * is active (non-identity), every adjustment node on a NESTED group stopped
 * rendering entirely.
 *
 * Root cause: the compositor tracked group-scratch accumulation with a
 * single `active_group_id` scalar and a single pre-adjustment cache slot
 * (keyed by one group id). `child_to_group` (built by flattening every
 * group's descendants, including through nested adjusted sub-groups) could
 * map the same leaf layer to two different adjusted groups at once — the
 * nested group AND its adjusted ancestor — so whichever group's entry the
 * HashMap iteration happened to keep last "won" that leaf, silently
 * dropping the other group's entire scratch/adjustment pass. The fix
 * (a) stops the JS-side descendant flattening at a nested group that itself
 * needs routing, so each descendant maps to exactly one immediate parent
 * group, and (b) replaces the compositor's single active-group slot with a
 * proper stack, so a nested group's finalized (already-adjusted) output
 * blends into its ancestor's scratch instead of colliding with it.
 *
 * This test builds the exact repro from the issue: a nested group with a
 * non-identity Hue/Saturation adjustment, verified correct on its own, then
 * an adjustment added to the ROOT group. The root's adjustment is
 * Saturation (not Exposure, as in the issue's literal script) because
 * Exposure is a pure multiplier and has no visible effect on a fully
 * saturated primary color (0 stays 0, 255 clamps to 255) — Saturation
 * gives an unambiguous, order-dependent oracle: full desaturation must
 * land on the NESTED (post-hue-rotation) color's luminance, not the
 * original pre-nested-adjustment color's. Per the issue, any active root
 * adjustment (including Exposure or Auto Contrast's appended Levels node)
 * triggers the same routing bug, since the fix operates on routing, not on
 * any particular adjustment type.
 */

interface PixelResult { r: number; g: number; b: number; a: number }

async function readCompositedAtDoc(page: Page, docX: number, docY: number): Promise<PixelResult> {
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

/** Builds a 1500x500 white doc with Layer 1 active, matching the issue's repro doc. */
async function setupDocument(page: Page): Promise<void> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 1500, 500, false);
}

test.describe('#857 nested group adjustments survive a root-group adjustment', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layers/effects panels are desktop-only');
  });

  test('root Saturation composes on top of a nested Hue/Saturation instead of erasing it', async ({ page }) => {
    await setupDocument(page);

    const rootGroupId = await getRootGroupId(page);
    // New groups already default to 'normal' blend mode (#523), but keep
    // this explicit so the precondition for group adjustments to composite
    // through the scratch FBO (rather than pass-through bypass) is obvious.
    await setGroupBlendMode(page, rootGroupId, 'normal');

    // Step 1: with Layer 1 active (the default active layer after
    // createDocument), create a nested group and add a layer inside it.
    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const afterNewGroup = await getEditorState(page);
    const grpId = afterNewGroup.document.activeLayerId;
    const grp = afterNewGroup.document.layers.find((l) => l.id === grpId);
    expect(grp).toBeTruthy();

    const poolId = await addLayer(page);
    const afterAddLayer = await getEditorState(page);
    const poolParent = afterAddLayer.document.layers.find(
      (l) => (l as unknown as { type: string; children?: string[] }).type === 'group'
        && (l as unknown as { children?: string[] }).children?.includes(poolId),
    );
    expect(poolParent?.id).toBe(grpId);

    // Step 2: marquee-select a rectangle on Pool and fill it red, deselect.
    await drawRect(page, 400, 300, 300, 120, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(150);

    const probeX = 550;
    const probeY = 360;

    const redOnly = await readCompositedAtDoc(page, probeX, probeY);
    expect(redOnly.r).toBeGreaterThan(200);
    expect(redOnly.g).toBeLessThan(40);
    expect(redOnly.b).toBeLessThan(40);

    // Step 3: add a Hue/Saturation node to the NESTED group with Hue = 120.
    // Rotating pure red by +120 degrees lands on pure green.
    await addAdjustment(page, grpId, 'hue-saturation', { hue: 120 });
    await page.waitForTimeout(300);

    const greenOnly = await readCompositedAtDoc(page, probeX, probeY);
    expect(greenOnly.r).toBeLessThan(40);
    expect(greenOnly.g).toBeGreaterThan(200);
    expect(greenOnly.b).toBeLessThan(40);
    expect(greenOnly.a).toBeGreaterThan(200);

    await page.screenshot({ path: 'e2e/screenshots/group-adj-nested-857-green.png' });

    // Step 4: add a Saturation adjustment to the ROOT group (any active
    // root-group adjustment reproduces the bug per the issue — Saturation
    // gives the clearest oracle here). Full desaturation (-100) must land
    // on the LUMINANCE OF THE ALREADY-GREEN PIXEL (~0.7152 * 255 ≈ 182),
    // not the luminance of the original pre-nested-adjustment red
    // (~0.2126 * 255 ≈ 54). The old bug dropped the nested group's scratch
    // entirely, so the composite would show the root's own scratch built
    // from Pool's UNADJUSTED (still red) content, desaturated to the red
    // luminance — i.e. a dark, not light, gray.
    await addAdjustment(page, rootGroupId, 'saturation', { saturation: -100 });
    await page.waitForTimeout(300);

    const composed = await readCompositedAtDoc(page, probeX, probeY);

    await page.screenshot({ path: 'e2e/screenshots/group-adj-nested-857-composed.png' });

    // Desaturation must have actually run (r/g/b converge to the same
    // value) — this alone falsifies "root adjustment silently no-ops".
    expect(Math.abs(composed.r - composed.g)).toBeLessThan(15);
    expect(Math.abs(composed.g - composed.b)).toBeLessThan(15);

    // The bug: composite reverts toward the RED luminance (~54) because
    // the nested Hue+120 pass was dropped. The fix: composite lands near
    // the GREEN luminance (~182) because the nested pass still ran and the
    // root's desaturation composed on top of its result.
    expect(composed.g).toBeGreaterThan(140);
    expect(composed.a).toBeGreaterThan(200);
  });

  test('root adjustment composes on top of a nested Gradient Map', async ({ page }) => {
    await setupDocument(page);

    const rootGroupId = await getRootGroupId(page);
    await setGroupBlendMode(page, rootGroupId, 'normal');

    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const grpId = (await getEditorState(page)).document.activeLayerId;

    await addLayer(page);
    await drawRect(page, 400, 300, 300, 120, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(150);

    const probeX = 550;
    const probeY = 360;

    // Default Gradient Map node is a black->white ramp, which maps every
    // pixel to a grayscale value equal to its own luminance. Pure red's
    // luminance is ~0.2126 * 255 ≈ 54, so the nested group alone should
    // turn the rectangle a dark gray.
    await addAdjustment(page, grpId, 'gradient-map');
    await page.waitForTimeout(300);

    const nestedOnly = await readCompositedAtDoc(page, probeX, probeY);
    expect(Math.abs(nestedOnly.r - nestedOnly.g)).toBeLessThan(15);
    expect(Math.abs(nestedOnly.g - nestedOnly.b)).toBeLessThan(15);
    expect(nestedOnly.r).toBeGreaterThan(30);
    expect(nestedOnly.r).toBeLessThan(90);

    await page.screenshot({ path: 'e2e/screenshots/group-adj-nested-857-gradientmap-nested.png' });

    // Root gets Invert. Inverting the dark gray from the nested Gradient
    // Map lands near 255-54=201 (light gray). The old bug would instead
    // invert Pool's UNADJUSTED red (dropping the nested pass), landing
    // near (0, 255, 255) — cyan, not gray at all.
    await addAdjustment(page, rootGroupId, 'invert');
    await page.waitForTimeout(300);

    const composed = await readCompositedAtDoc(page, probeX, probeY);

    await page.screenshot({ path: 'e2e/screenshots/group-adj-nested-857-gradientmap-composed.png' });

    expect(Math.abs(composed.r - composed.g)).toBeLessThan(15);
    expect(Math.abs(composed.g - composed.b)).toBeLessThan(15);
    expect(composed.r).toBeGreaterThan(160);
    expect(composed.a).toBeGreaterThan(200);
  });
});
