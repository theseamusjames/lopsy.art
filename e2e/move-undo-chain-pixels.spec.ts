/**
 * #925 — undoing (and redoing) a chain of selection Moves must restore the
 * pixels of each intermediate step, not just the marquee.
 *
 * A float's composite writes the layer texture without marking the layer
 * dirty, so pushHistory reused the previous entry's GPU snapshot for every
 * Move after the second one. Undo then put the marquee back correctly but
 * left the content frozen at the first drag's position until the chain was
 * undone past its second entry. #885 / #930 only resynced the transform
 * handle overlay and asserted on bounds, so they could not see this: every
 * step below asserts on the layer's actual pixels.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  docToScreen,
  selectTool,
  setForegroundColor,
  undo,
  redo,
} from './helpers';

const SQUARE = { x: 20, y: 60, size: 40 };
const STEP = 60;
const DOC_W = 400;

async function dragDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const s = await docToScreen(page, from.x, from.y);
  const e = await docToScreen(page, to.x, to.y);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

/**
 * Every red run (inclusive left, exclusive right, in doc x) along one row of
 * the active layer.
 * Reads the layer back once per call; probing pixel by pixel through
 * getPixelAt costs a full-layer readback each.
 */
async function redRuns(page: Page, docY: number): Promise<Array<[number, number]>> {
  return page.evaluate(async ({ docY, docW }) => {
    const store = (window as unknown as { __editorStore: { getState: () => {
      document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
    } } }).__editorStore;
    const { activeLayerId, layers } = store.getState().document;
    const layer = layers.find((l) => l.id === activeLayerId);
    const read = (window as unknown as { __readLayerPixels: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null> }).__readLayerPixels;
    const result = await read(activeLayerId);
    if (!layer || !result) return [];
    const isRed = (x: number): boolean => {
      const lx = x - layer.x;
      const ly = docY - layer.y;
      if (lx < 0 || lx >= result.width || ly < 0 || ly >= result.height) return false;
      const i = (ly * result.width + lx) * 4;
      return (result.pixels[i + 3] ?? 0) > 200 && (result.pixels[i] ?? 0) > 200 && (result.pixels[i + 1] ?? 0) < 50;
    };
    const runs: Array<[number, number]> = [];
    for (let x = 0; x < docW; x++) {
      if (isRed(x) && !isRed(x - 1)) runs.push([x, x + 1]);
      else if (isRed(x)) runs[runs.length - 1]![1] = x + 1;
    }
    return runs;
  }, { docY, docW: DOC_W });
}

async function redSquareLefts(page: Page): Promise<number[]> {
  const runs = await redRuns(page, SQUARE.y + SQUARE.size / 2);
  return runs.map(([left]) => left);
}

async function selectionX(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const store = (window as unknown as { __editorStore: { getState: () => { selection: { bounds: { x: number } | null } } } }).__editorStore;
    return store.getState().selection.bounds?.x ?? null;
  });
}

async function fillSelectedSquare(page: Page): Promise<void> {
  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'marquee-rect');
  await dragDoc(
    page,
    { x: SQUARE.x, y: SQUARE.y },
    { x: SQUARE.x + SQUARE.size, y: SQUARE.y + SQUARE.size },
  );
  await selectTool(page, 'fill');
  const f = await docToScreen(page, SQUARE.x + SQUARE.size / 2, SQUARE.y + SQUARE.size / 2);
  await page.mouse.click(f.x, f.y);
  await page.waitForTimeout(100);
  expect(await redSquareLefts(page)).toEqual([SQUARE.x]);
}

test.describe('undo/redo through a chain of selection moves restores pixels (#925)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'drag-based test, needs a desktop pointer');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, 300, false);
  });

  test('content follows the marquee on every undo and redo step of four Move drags', async ({ page }) => {
    await fillSelectedSquare(page);

    await selectTool(page, 'move');
    const positions = [SQUARE.x];
    const probeY = SQUARE.y + SQUARE.size / 2;
    for (let i = 0; i < 4; i++) {
      const from = positions[positions.length - 1]! + SQUARE.size / 2;
      await dragDoc(page, { x: from, y: probeY }, { x: from + STEP, y: probeY });
      positions.push(positions[positions.length - 1]! + STEP);
    }
    // positions = [20, 80, 140, 200, 260]
    expect(await selectionX(page)).toBe(positions[4]);
    expect(await redSquareLefts(page)).toEqual([positions[4]]);

    for (let step = 3; step >= 0; step--) {
      await undo(page);
      await page.waitForTimeout(150);
      const expected = positions[step]!;
      expect(await selectionX(page), `marquee after undo to step ${step}`).toBe(expected);
      expect(await redSquareLefts(page), `content after undo to step ${step}`).toEqual([expected]);
    }

    for (let step = 1; step <= 4; step++) {
      await redo(page);
      await page.waitForTimeout(150);
      const expected = positions[step]!;
      expect(await selectionX(page), `marquee after redo to step ${step}`).toBe(expected);
      expect(await redSquareLefts(page), `content after redo to step ${step}`).toEqual([expected]);
    }
  });

  test('content follows the marquee on every undo step of separate arrow-key nudges', async ({ page }) => {
    await fillSelectedSquare(page);

    await selectTool(page, 'move');
    const positions = [SQUARE.x];
    for (let i = 0; i < 4; i++) {
      // Shift+Right nudges 10px; three separate presses per step, each its
      // own "Nudge" history entry.
      for (let k = 0; k < 3; k++) {
        await page.keyboard.press('Shift+ArrowRight');
        await page.waitForTimeout(60);
      }
      positions.push(positions[positions.length - 1]! + 30);
    }
    const last = positions[positions.length - 1]!;
    expect(await selectionX(page)).toBe(last);
    expect(await redSquareLefts(page)).toEqual([last]);

    // Undo one press (10px) at a time and check every intermediate step.
    for (let x = last - 10; x >= SQUARE.x; x -= 10) {
      await undo(page);
      await page.waitForTimeout(150);
      expect(await selectionX(page), `marquee after undo to x=${x}`).toBe(x);
      expect(await redSquareLefts(page), `content after undo to x=${x}`).toEqual([x]);
    }
  });

  test('content matches each step when undoing a chain of Free Transform scale drags', async ({ page }) => {
    await fillSelectedSquare(page);
    await selectTool(page, 'move');

    // Grow the square from its bottom-right handle three times; the top-left
    // corner stays anchored, so the width along a row near the top is the
    // square's size at that step.
    const sizes = [SQUARE.size];
    for (let i = 0; i < 3; i++) {
      const size = sizes[sizes.length - 1]!;
      const corner = { x: SQUARE.x + size, y: SQUARE.y + size };
      await dragDoc(page, corner, { x: corner.x + 20, y: corner.y + 20 });
      sizes.push(size + 20);
    }
    // sizes = [40, 60, 80, 100]
    const rowY = SQUARE.y + 5;
    // Resampling softens the scaled edges by a pixel, so match within 2px.
    const expectSquareWidth = async (size: number, label: string): Promise<void> => {
      const runs = await redRuns(page, rowY);
      expect(runs, label).toHaveLength(1);
      expect(Math.abs(runs[0]![0] - SQUARE.x), `${label}: left edge ${runs[0]![0]}`).toBeLessThanOrEqual(2);
      expect(Math.abs(runs[0]![1] - (SQUARE.x + size)), `${label}: right edge ${runs[0]![1]}`).toBeLessThanOrEqual(2);
    };
    await expectSquareWidth(sizes[3]!, 'after three scale drags');

    for (let step = 2; step >= 0; step--) {
      await undo(page);
      await page.waitForTimeout(150);
      await expectSquareWidth(sizes[step]!, `content after undo to step ${step}`);
    }
  });
});
