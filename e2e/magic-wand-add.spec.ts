import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setForegroundColor,
  setToolOption,
} from './helpers';

/** Read the active selection mask value at a document coordinate. */
async function selectionMaskAt(page: Page, docX: number, docY: number): Promise<number> {
  return page.evaluate(
    ({ x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          selection: { active: boolean; mask: Uint8ClampedArray | null; maskWidth: number };
        };
      };
      const sel = store.getState().selection;
      if (!sel.active || !sel.mask) return 0;
      return sel.mask[y * sel.maskWidth + x] ?? 0;
    },
    { x: docX, y: docY },
  );
}

test('shift-clicking the magic wand adds each shape to the selection', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  // Paint two well-separated solid blobs on a transparent layer with the brush
  // (native GPU path, so the wand's pixel readback sees them).
  await addLayer(page);
  await setForegroundColor(page, 255, 0, 0);
  await page.keyboard.press('b');
  await page.waitForTimeout(50);
  await setToolOption(page, 'Size', 60);
  await setToolOption(page, 'Hardness', 100);
  await setToolOption(page, 'Opacity', 100);

  const blobA = { x: 110, y: 150 };
  const blobB = { x: 290, y: 150 };
  for (const blob of [blobA, blobB]) {
    const s = await docToScreen(page, blob.x, blob.y);
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(200);
  }

  // Magic wand: click the first blob — only it should be selected.
  await page.keyboard.press('w');
  await page.waitForTimeout(50);
  const sA = await docToScreen(page, blobA.x, blobA.y);
  await page.mouse.click(sA.x, sA.y);
  await page.waitForTimeout(200);

  expect(await selectionMaskAt(page, blobA.x, blobA.y)).toBeGreaterThan(0);
  expect(await selectionMaskAt(page, blobB.x, blobB.y)).toBe(0);

  // Shift-click the second blob — it should be ADDED, keeping the first.
  const sB = await docToScreen(page, blobB.x, blobB.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(sB.x, sB.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);

  expect(await selectionMaskAt(page, blobA.x, blobA.y)).toBeGreaterThan(0);
  expect(await selectionMaskAt(page, blobB.x, blobB.y)).toBeGreaterThan(0);
});
