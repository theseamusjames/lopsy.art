import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  drawRect,
  getPixelAt,
  withEditorStore,
} from './helpers';

// #1823: a held key's keydown auto-repeats must not re-run one-shot document
// commands. Holding Delete with a selection used to push a "Clear Selection"
// history step, take a full-layer GPU snapshot and re-upload the selection
// mask on every repeat. Undo and redo still repeat while held.

function undoDepth(page: Page): Promise<number> {
  return withEditorStore(page, (s) => (s.undoStack as unknown[]).length);
}

function gpuSnapshotCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __gpuSnapshotCount: () => number }).__gpuSnapshotCount());
}

async function holdKey(page: Page, key: string, repeats: number): Promise<void> {
  // Playwright sends keydown with `repeat: true` for a key already down.
  for (let i = 0; i <= repeats; i++) {
    await page.keyboard.down(key);
    await page.waitForTimeout(20);
  }
  await page.keyboard.up(key);
  await page.waitForTimeout(200);
}

async function setUp(page: Page): Promise<string> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);
  const layerId = await addLayer(page);
  await drawRect(page, 100, 100, 100, 100, { r: 255, g: 0, b: 0 });
  await page.waitForTimeout(200);
  return layerId;
}

async function marquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  await page.waitForTimeout(50);
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test('holding Delete with a selection clears once: one history step, one snapshot', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts need a hardware keyboard');
  const layerId = await setUp(page);
  await marquee(page, 120, 120, 180, 180);

  const depthBefore = await undoDepth(page);
  const snapshotsBefore = await gpuSnapshotCount(page);

  await holdKey(page, 'Delete', 15);

  // The selected pixels are cleared, the rest of the square is not.
  expect((await getPixelAt(page, 150, 150, layerId)).a).toBe(0);
  expect((await getPixelAt(page, 105, 105, layerId)).a).toBeGreaterThan(0);

  expect(await undoDepth(page) - depthBefore).toBe(1);
  // One Clear Selection step snapshots the layer once (allow one extra for
  // the step's own bookkeeping); 16 repeats used to take 16 or more.
  expect(await gpuSnapshotCount(page) - snapshotsBefore).toBeLessThanOrEqual(2);
  const labels = await withEditorStore(page, (s) =>
    (s.undoStack as { label: string }[]).map((e) => e.label),
  );
  expect(labels.filter((l) => l === 'Clear Selection')).toHaveLength(1);
});

test('holding Cmd/Ctrl+Shift+I inverts once', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts need a hardware keyboard');
  await setUp(page);
  await marquee(page, 120, 120, 180, 180);
  const depthBefore = await undoDepth(page);

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await holdKey(page, 'I', 9);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');

  expect(await undoDepth(page) - depthBefore).toBe(1);
  // An odd number of inverts would leave the marquee's inside unselected.
  const inside = await withEditorStore(page, (s) => {
    const sel = s.selection as { mask: Uint8ClampedArray; maskWidth: number };
    return sel.mask[150 * sel.maskWidth + 150];
  });
  expect(inside).toBe(0);
});

test('holding Cmd/Ctrl+Z still undoes step after step', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts need a hardware keyboard');
  await setUp(page);
  await drawRect(page, 10, 10, 20, 20, { r: 0, g: 0, b: 255 });
  await drawRect(page, 40, 10, 20, 20, { r: 0, g: 255, b: 0 });
  await page.waitForTimeout(200);
  const depthBefore = await undoDepth(page);
  expect(depthBefore).toBeGreaterThanOrEqual(3);

  await page.keyboard.down('Control');
  await holdKey(page, 'z', 2);
  await page.keyboard.up('Control');

  expect(depthBefore - await undoDepth(page)).toBe(3);
});
