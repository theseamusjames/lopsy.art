// Regression test for #235: Gaussian Blur (and other filters that read
// from scratch FBOs) must work correctly on layers smaller than the
// document. Before the fix, the scratch textures were doc-sized but the
// viewport was set to the layer size, so pass-2 sampled garbage outside
// the valid sub-region and destroyed layer content.

import { test, expect } from './fixtures';
import { createDocument, waitForStore, drawEllipse, applyFilter, getPixelAt } from './helpers';

test.describe('filter bounds (#235)', () => {
  test('Gaussian Blur on a small ellipse layer preserves the ellipse content', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox WebGL two-pass blur destroys small-layer content');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);

    // A small ellipse positioned away from the doc origin — this is the
    // case that used to break: the layer's content area is much smaller
    // than the doc-sized scratch texture.
    const cream = { r: 240, g: 230, b: 210 };
    await drawEllipse(page, 400, 300, 100, 50, cream);

    // Sample the ellipse center BEFORE the blur to confirm content exists.
    const before = await getPixelAt(page, 400, 300);
    expect(before.a).toBeGreaterThan(200);
    expect(before.r).toBeGreaterThan(200);
    expect(before.g).toBeGreaterThan(200);
    expect(before.b).toBeGreaterThan(150);

    // Apply Gaussian Blur radius=2 — should soften the edges, not blank
    // the ellipse out.
    await applyFilter(page, 'Gaussian Blur...', { Radius: 2 });

    // After the blur the center pixel should still be near the cream
    // colour. Before the fix it became near-zero (alpha mostly gone),
    // because the shader read garbage outside the layer's sub-region of
    // the scratch texture.
    const after = await getPixelAt(page, 400, 300);
    expect(after.a).toBeGreaterThan(200);
    expect(after.r).toBeGreaterThan(180);
    expect(after.g).toBeGreaterThan(180);
    expect(after.b).toBeGreaterThan(140);
  });
});
