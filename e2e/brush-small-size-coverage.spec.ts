import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  addLayer,
  selectTool,
  setToolOption,
  setForegroundColor,
  docToScreen,
  getPixelAt,
} from './helpers';

// ---------------------------------------------------------------------------
// Regression test for #849: at Hardness 100 / Opacity 100, brush sizes below
// ~3px painted almost nothing (size 1 painted zero alpha anywhere, size 2
// peaked at alpha 53/255). Every line drawn here must reach (near) full
// opacity at its centre, regardless of width.
// ---------------------------------------------------------------------------

async function pushHistory(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory('test');
  });
  await page.waitForTimeout(200);
}

async function drawHorizontalLine(page: Page, y: number, size: number): Promise<void> {
  await setToolOption(page, 'Size', size);
  const start = await docToScreen(page, 60, y);
  const end = await docToScreen(page, 340, y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Many steps so dabs are packed densely along the stroke — this is what
  // real, slow mouse movement produces, and it's the scenario the bug
  // report measured (a continuous line, not a handful of clicks).
  await page.mouse.move(end.x, end.y, { steps: 140 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * The dab centre for a horizontal line rarely lands exactly on a pixel row,
 * so "peak alpha across the stroke" means scanning a few rows around the
 * nominal y and taking the maximum — exactly how the issue's own repro
 * table was produced.
 */
async function peakAlphaNear(page: Page, layerId: string, x: number, y: number): Promise<number> {
  let peak = 0;
  for (let dy = -3; dy <= 3; dy++) {
    const pixel = await getPixelAt(page, x, y + dy, layerId);
    if (pixel.a > peak) peak = pixel.a;
  }
  return peak;
}

test.describe('Brush small-size coverage (#849)', () => {
  test('1-2px brushes reach full alpha at Hardness 100 / Opacity 100', async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires desktop-size viewport for layers panel');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const layerId = await addLayer(page);

    await selectTool(page, 'brush');
    await setForegroundColor(page, 0, 0, 0);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Opacity', 100);

    const lines: Array<{ size: number; y: number }> = [
      { size: 1, y: 60 },
      { size: 2, y: 100 },
      { size: 3, y: 140 },
      { size: 4, y: 180 },
    ];

    for (const { size, y } of lines) {
      await drawHorizontalLine(page, y, size);
    }

    await pushHistory(page);
    await page.screenshot({ path: 'e2e/screenshots/brush-small-size-coverage.png' });

    const peaks: Record<number, number> = {};
    for (const { size, y } of lines) {
      peaks[size] = await peakAlphaNear(page, layerId, 200, y);
    }

    // eslint-disable-next-line no-console
    console.log('Peak alpha by size:', peaks);

    // The bug: size 1 painted alpha 0 and size 2 peaked at 53. Both must now
    // reach (near) full opacity, matching what size 3/4 already achieved.
    expect(peaks[1]).toBeGreaterThan(245);
    expect(peaks[2]).toBeGreaterThan(245);
    expect(peaks[3]).toBeGreaterThan(245);
    expect(peaks[4]).toBeGreaterThan(245);

    // Sanity: a region clearly between the lines must stay unpainted — this
    // guards against a broken fix that just floods the whole layer opaque.
    const betweenLines = await getPixelAt(page, 200, 80, layerId);
    expect(betweenLines.a).toBeLessThan(10);
  });

  test('hardness 0 and 50 still fall off away from the stroke centre', async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires desktop-size viewport for layers panel');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const layerId = await addLayer(page);

    await selectTool(page, 'brush');
    await setForegroundColor(page, 0, 0, 0);
    await setToolOption(page, 'Opacity', 100);
    await setToolOption(page, 'Size', 40);

    // A soft (hardness 0) and a mid (hardness 50) stroke at a size well
    // above the small-radius floor, so this exercises the untouched part
    // of the coverage formula and guards against the #849 fix regressing
    // softness for normal-sized brushes.
    await setToolOption(page, 'Hardness', 0);
    await drawHorizontalLine(page, 80, 40);

    await setToolOption(page, 'Hardness', 50);
    await drawHorizontalLine(page, 180, 40);

    await pushHistory(page);

    const softCenter = await peakAlphaNear(page, layerId, 200, 80);
    const softEdge = await getPixelAt(page, 200, 80 - 19, layerId); // near the 20px radius edge
    const midCenter = await peakAlphaNear(page, layerId, 200, 180);
    const midEdge = await getPixelAt(page, 200, 180 - 19, layerId);

    // eslint-disable-next-line no-console
    console.log({ softCenter, softEdge: softEdge.a, midCenter, midEdge: midEdge.a });

    // Centres are always fully painted regardless of hardness.
    expect(softCenter).toBeGreaterThan(245);
    expect(midCenter).toBeGreaterThan(245);

    // Softer brushes fade well before the edge; a hardness-0 stroke should
    // be noticeably fainter at its edge than a hardness-50 one at the same
    // offset, and both must be clearly below full strength there.
    expect(softEdge.a).toBeLessThan(midEdge.a);
    expect(softEdge.a).toBeLessThan(200);
  });
});
