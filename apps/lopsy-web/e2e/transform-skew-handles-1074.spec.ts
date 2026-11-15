import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  selectTool,
} from './helpers';

// #1074 — in the Move tool's Skew mode a handle drag moved its edge twice the
// pointer distance, and the top/left handles moved their edge the opposite
// way to the drag. Each case below fills a black rectangle on a white
// document, skews it from one edge handle by 60 doc px, and checks that the
// dragged edge followed the pointer exactly while the opposite edge stayed
// put — first in the live preview (float still up), then after ⌘D commits.

const DOC_W = 800;
const DOC_H = 600;
const TOL = 3;

type Rect = { x: number; y: number; w: number; h: number };

interface Probe {
  /** 'col' scans doc column `at` for dark rows; 'row' scans doc row `at` for dark columns. */
  line: 'col' | 'row';
  at: number;
  /** Expected first and last dark doc coordinate along the line. */
  expected: [number, number];
}

interface SkewCase {
  name: string;
  rect: Rect;
  from: { x: number; y: number };
  delta: { x: number; y: number };
  probes: Probe[];
}

// Expected runs come from the sheared rectangle: the dragged edge moves by
// the full delta, the opposite edge by zero, and points in between linearly.
const CASES: SkewCase[] = [
  {
    // Left edge x=100 stays at y 200..260; right edge x=400 moves to y 140..200.
    name: 'right handle dragged up moves the right edge up by the drag',
    rect: { x: 100, y: 200, w: 300, h: 60 },
    from: { x: 400, y: 230 },
    delta: { x: 0, y: -60 },
    probes: [
      { line: 'col', at: 105, expected: [199, 258] },
      { line: 'col', at: 250, expected: [170, 229] },
      { line: 'col', at: 395, expected: [141, 200] },
    ],
  },
  {
    // Bottom edge y=400 stays at x 300..400; top edge y=200 moves to x 360..460.
    name: 'top handle dragged right moves the top edge right by the drag',
    rect: { x: 300, y: 200, w: 100, h: 200 },
    from: { x: 350, y: 200 },
    delta: { x: 60, y: 0 },
    probes: [
      { line: 'row', at: 205, expected: [358, 457] },
      { line: 'row', at: 300, expected: [330, 429] },
      { line: 'row', at: 395, expected: [301, 400] },
    ],
  },
  {
    // Right edge x=500 stays at y 250..350; left edge x=200 moves to y 190..290.
    name: 'left handle dragged up moves the left edge up by the drag',
    rect: { x: 200, y: 250, w: 300, h: 100 },
    from: { x: 200, y: 300 },
    delta: { x: 0, y: -60 },
    probes: [
      { line: 'col', at: 205, expected: [191, 290] },
      { line: 'col', at: 350, expected: [220, 319] },
      { line: 'col', at: 495, expected: [249, 348] },
    ],
  },
  {
    // Top edge y=200 stays at x 300..400; bottom edge y=400 moves to x 240..340.
    name: 'bottom handle dragged left moves the bottom edge left by the drag',
    rect: { x: 300, y: 200, w: 100, h: 200 },
    from: { x: 350, y: 400 },
    delta: { x: -60, y: 0 },
    probes: [
      { line: 'row', at: 205, expected: [298, 397] },
      { line: 'row', at: 300, expected: [270, 369] },
      { line: 'row', at: 395, expected: [241, 340] },
    ],
  },
];

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 10): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** First and last dark doc coordinate along each probe line, from the composited canvas. */
async function compositeRuns(page: Page, probes: Probe[]): Promise<Array<[number, number] | null>> {
  return page.evaluate(async (probes) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    const dpr = p.width / container.clientWidth;
    const isDark = (dx: number, dy: number): boolean => {
      const sx = Math.floor(((dx + 0.5 - doc.width / 2) * vp.zoom + vp.panX) * dpr + p.width / 2);
      const sy = Math.floor(((dy + 0.5 - doc.height / 2) * vp.zoom + vp.panY) * dpr + p.height / 2);
      const i = ((p.height - 1 - sy) * p.width + sx) * 4;
      return (p.pixels[i] ?? 255) < 128;
    };
    return probes.map((probe) => {
      const len = probe.line === 'col' ? doc.height : doc.width;
      let first = -1;
      let last = -1;
      for (let t = 0; t < len; t++) {
        const dark = probe.line === 'col' ? isDark(probe.at, t) : isDark(t, probe.at);
        if (!dark) continue;
        if (first < 0) first = t;
        last = t;
      }
      return first < 0 ? null : ([first, last] as [number, number]);
    });
  }, probes);
}

/** Same scan against the committed layer texture. */
async function layerRuns(page: Page, layerId: string, probes: Probe[]): Promise<Array<[number, number] | null>> {
  return page.evaluate(async ({ lid, probes }) => {
    const w = window as unknown as {
      __editorStore: { getState: () => { document: { layers: { id: string; x: number; y: number }[] } } };
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === lid)!;
    const px = await w.__readLayerPixels(lid);
    const isDark = (dx: number, dy: number): boolean => {
      const lx = dx - layer.x;
      const ly = dy - layer.y;
      if (lx < 0 || ly < 0 || lx >= px.width || ly >= px.height) return false;
      return (px.pixels[(ly * px.width + lx) * 4 + 3] ?? 0) > 128;
    };
    return probes.map((probe) => {
      let first = -1;
      let last = -1;
      for (let t = -200; t < 1200; t++) {
        const dark = probe.line === 'col' ? isDark(probe.at, t) : isDark(t, probe.at);
        if (!dark) continue;
        if (first < 0) first = t;
        last = t;
      }
      return first < 0 ? null : ([first, last] as [number, number]);
    });
  }, { lid: layerId, probes });
}

function expectRuns(label: string, actual: Array<[number, number] | null>, probes: Probe[]): void {
  probes.forEach((probe, i) => {
    const run = actual[i];
    const where = `${label}: ${probe.line} ${probe.at} → ${JSON.stringify(run)}, expected ${JSON.stringify(probe.expected)}`;
    expect(run, where).not.toBeNull();
    expect(Math.abs(run![0] - probe.expected[0]), where).toBeLessThanOrEqual(TOL);
    expect(Math.abs(run![1] - probe.expected[1]), where).toBeLessThanOrEqual(TOL);
  });
}

async function fillRectOnNewLayer(page: Page, rect: Rect): Promise<string> {
  const layerId = await addLayer(page);
  await setActiveLayer(page, layerId);
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h, 5);
  await page.locator('nav[aria-label="Application menu"] button:has-text("Edit")').click();
  await page.locator('[role="menu"][aria-label="Edit"] [role="menuitem"]').filter({ hasText: /^Fill(?! with)/ }).click();
  await page.waitForTimeout(150);
  return layerId;
}

test.describe('#1074: Skew handles track the pointer', () => {
  for (const c of CASES) {
    test(c.name, async ({ page, isMobile }) => {
      test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
      await page.goto('/');
      await waitForStore(page);
      await createDocument(page, DOC_W, DOC_H, false);
      await page.waitForSelector('[data-testid="canvas-container"]');
      await page.waitForTimeout(300);

      const layerId = await fillRectOnNewLayer(page, c.rect);

      await page.keyboard.press('v');
      await page.waitForTimeout(100);
      await page.locator('button:has-text("Skew")').click();
      await page.waitForTimeout(150);
      await dragDoc(page, c.from.x, c.from.y, c.from.x + c.delta.x, c.from.y + c.delta.y, 15);

      const slug = c.name.split(' ')[0];
      await page.screenshot({ path: `e2e/screenshots/skew-handle-${slug}-preview.png` });
      const preview = await compositeRuns(page, c.probes);
      expectRuns('preview', preview, c.probes);

      await page.keyboard.press('Control+d');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/screenshots/skew-handle-${slug}-committed.png` });

      const committed = await compositeRuns(page, c.probes);
      expectRuns('committed composite', committed, c.probes);
      expectRuns('committed layer', await layerRuns(page, layerId, c.probes), c.probes);

      // The live preview and the committed pixels agree.
      c.probes.forEach((_, i) => {
        expect(Math.abs(preview[i]![0] - committed[i]![0])).toBeLessThanOrEqual(1);
        expect(Math.abs(preview[i]![1] - committed[i]![1])).toBeLessThanOrEqual(1);
      });
    });
  }
});
