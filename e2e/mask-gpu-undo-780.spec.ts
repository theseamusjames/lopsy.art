import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, setToolOption, docToScreen, undo, redo, getEditorState } from './helpers';

/**
 * #780 — a mask stroke started right after another one must not pay a
 * synchronous mask readback on pointer-down.
 *
 * The previous stroke's readback sits in a quiescence queue until the GPU
 * has drained. Starting a second stroke used to drain that queue on the
 * spot (`flushPendingMaskRead` in the paint handler, then again inside
 * `pushHistory`) — a `glReadPixels` stuck behind the first stroke's GPU
 * backlog, seconds long on a 4K document. History now snapshots masks
 * GPU→GPU, so pointer-down reads nothing back.
 *
 * `readMaskTexture` is the only GPU→CPU read on the mask pointer-down
 * path, and every GPU→CPU read in WebGL2 goes through `readPixels`, so the
 * test counts `readPixels` calls made while the pointer-down event is
 * being dispatched. It then checks, through undo and redo, that the GPU
 * snapshots restore the right mask and that the JS copy of the mask
 * catches up with it.
 */

const DOC_W = 1200;
const DOC_H = 900;
const STROKE_1_Y = 250;
const STROKE_2_Y = 650;

async function installReadPixelsCounter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __readPixelsCalls: number;
      __pointerDownReads: number[];
    };
    w.__readPixelsCalls = 0;
    w.__pointerDownReads = [];
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.readPixels;
    proto.readPixels = function patched(this: WebGL2RenderingContext, ...args: unknown[]) {
      w.__readPixelsCalls++;
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.readPixels;

    // Capture on window runs before the app's window-level pointerdown
    // handler; a bubble listener registered now runs after it.
    let atStart = 0;
    window.addEventListener('pointerdown', () => { atStart = w.__readPixelsCalls; }, { capture: true });
    window.addEventListener('pointerdown', () => {
      w.__pointerDownReads.push(w.__readPixelsCalls - atStart);
    });
  });
}

async function pointerDownReads(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __pointerDownReads: number[] }).__pointerDownReads);
}

/** Mean `layer.mask.data` value in a 21x21 box centred on (cx, cy). */
async function maskMean(page: Page, cx: number, cy: number): Promise<number> {
  return page.evaluate(({ cx, cy }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          activeLayerId: string | null;
          layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number } | null }>;
        };
      };
    };
    const state = store.getState();
    const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
    if (!layer?.mask) return -1;
    let sum = 0;
    let n = 0;
    for (let y = cy - 10; y <= cy + 10; y++) {
      for (let x = cx - 10; x <= cx + 10; x++) {
        sum += layer.mask.data[y * layer.mask.width + x] ?? 0;
        n++;
      }
    }
    return sum / n;
  }, { cx, cy });
}

async function expectMask(page: Page, stroke1: 'hidden' | 'shown', stroke2: 'hidden' | 'shown'): Promise<void> {
  // The JS copy of the mask refreshes lazily once the GPU is idle, so poll.
  // Painted (hide) is 0, unpainted (reveal) is 255.
  const matches = (v: number, want: 'hidden' | 'shown') => (want === 'hidden' ? v < 40 : v > 215);
  await expect.poll(async () => {
    const a = await maskMean(page, DOC_W / 2, STROKE_1_Y);
    const b = await maskMean(page, DOC_W / 2, STROKE_2_Y);
    return matches(a, stroke1) && matches(b, stroke2) ? 'ok' : `stroke1=${a.toFixed(0)} stroke2=${b.toFixed(0)}`;
  }, { timeout: 30_000 }).toBe('ok');
}

/**
 * Undo/redo are applied on the next animation frame (#761 coalescing), so
 * wait for the stack to move before probing the mask.
 */
async function historyStep(page: Page, dir: 'undo' | 'redo'): Promise<void> {
  const before = (await getEditorState(page)).undoStackLength;
  await (dir === 'undo' ? undo(page) : redo(page));
  const expected = dir === 'undo' ? before - 1 : before + 1;
  await expect.poll(async () => (await getEditorState(page)).undoStackLength, { timeout: 30_000 }).toBe(expected);
}

async function strokeAcross(page: Page, y: number): Promise<void> {
  const start = await docToScreen(page, 100, y);
  const end = await docToScreen(page, DOC_W - 100, y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 25 });
  await page.mouse.up();
}

test.describe('#780 — mask strokes snapshot on the GPU', () => {
  test('a back-to-back mask stroke reads nothing back on pointer-down, and undo/redo restore both strokes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    test.setTimeout(600_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, false);

    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await expect.poll(() => page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as { getState: () => { maskMode: string } };
      return ui.getState().maskMode;
    })).toBe('layerMask');

    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 60);
    await expectMask(page, 'shown', 'shown');

    await installReadPixelsCounter(page);

    // Second stroke starts the moment the first one ends — well inside the
    // readback queue's quiet-frame / 3 s window.
    await strokeAcross(page, STROKE_1_Y);
    await strokeAcross(page, STROKE_2_Y);

    const reads = await pointerDownReads(page);
    expect(reads).toHaveLength(2);
    expect(reads[1]).toBe(0);
    expect(reads[0]).toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/mask-gpu-undo-both-strokes.png' });
    await expectMask(page, 'hidden', 'hidden');

    // Undo the second stroke: only the first stays painted.
    await historyStep(page, 'undo');
    await expectMask(page, 'hidden', 'shown');

    // Undo the first stroke: the mask is back to fully revealed.
    await historyStep(page, 'undo');
    await expectMask(page, 'shown', 'shown');

    await historyStep(page, 'redo');
    await expectMask(page, 'hidden', 'shown');
    await historyStep(page, 'redo');
    await expectMask(page, 'hidden', 'hidden');
  });

  test('undo right after a back-to-back stroke restores the GPU mask, not the lagging JS copy', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    test.setTimeout(600_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, false);

    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 60);

    // Two strokes and an immediate undo, before any lazy readback has had
    // a chance to land: the snapshot the undo restores carries mask bytes
    // older than its GPU handle. If those bytes were re-uploaded, stroke 1
    // would vanish along with stroke 2.
    await strokeAcross(page, STROKE_1_Y);
    await strokeAcross(page, STROKE_2_Y);
    await historyStep(page, 'undo');

    await page.screenshot({ path: 'e2e/screenshots/mask-gpu-undo-immediate.png' });
    await expectMask(page, 'hidden', 'shown');
  });
});

test.describe('#780 — project save materializes a lagging mask', () => {
  test('a mask stroke saved straight away round-trips through .lopsy', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    test.setTimeout(600_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);

    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 60);

    const start = await docToScreen(page, 50, 200);
    const end = await docToScreen(page, 550, 200);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 20 });
    await page.mouse.up();

    // Save immediately — the JS copy of the mask has not been refreshed
    // yet, so save must read the GPU mask back itself.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Save Project' }).click();
    const download = await downloadPromise;
    const saved = readFileSync(await download.path());

    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('button:has-text("Open File")'),
    ]);
    await chooser.setFiles({ name: 'mask-roundtrip.lopsy', mimeType: 'application/octet-stream', buffer: saved });
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 30_000 });

    // The painted row y=200 is hidden (0); row y=350, well clear of the
    // 60 px brush, is still revealed (255).
    await expect.poll(() => page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ mask: { data: Uint8ClampedArray; width: number } | null }> };
        };
      };
      const mask = store.getState().document.layers.find((l) => l.mask)?.mask;
      if (!mask) return 'no mask';
      const at = (x: number, y: number) => mask.data[y * mask.width + x] ?? -1;
      return `painted=${at(300, 200)} clear=${at(300, 350)}`;
    }), { timeout: 20_000 }).toBe('painted=0 clear=255');
  });
});
