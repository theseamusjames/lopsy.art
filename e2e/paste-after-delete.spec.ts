/**
 * Regression test for #870: pasting internally-copied content after an
 * intervening Delete/Backspace (Clear Selection) used to fall back to the
 * external-image paste route (lands at 0,0, auto-selects, switches to Move)
 * instead of pasting in place at the copied offset.
 *
 * Root cause: Delete cleared pixels via `clipboardCut`, which re-copies the
 * *cleared* layer's pixels into the GPU-resident internal clipboard as a
 * side effect before wiping them — overwriting whatever ⌘C had staged there,
 * on any layer. The next ⌘V then failed the internal-clipboard dimension /
 * pixel match and treated the paste as a genuinely external image.
 */
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  setForegroundColor,
  selectTool,
  docToScreen,
  addLayer,
  setActiveLayer,
} from './helpers';

async function selectRect(page: Page, docX: number, docY: number, docW: number, docH: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await page.waitForTimeout(100);
  const start = await docToScreen(page, docX, docY);
  const end = await docToScreen(page, docX + docW, docY + docH);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function fillSelection(page: Page, r: number, g: number, b: number): Promise<void> {
  await setForegroundColor(page, r, g, b);
  await selectTool(page, 'fill');
  const box = await page.locator('[data-testid="canvas-container"]').boundingBox();
  if (!box) throw new Error('canvas container not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
}

interface Snapshot {
  document: {
    layers: Array<{ id: string; name: string; x: number; y: number }>;
    activeLayerId: string;
  };
  clipboard: { width: number; height: number; offsetX: number; offsetY: number } | null;
  activeTool: string;
}

async function getSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    const state = editor.getState();
    return {
      document: state.document as Snapshot['document'],
      clipboard: state.clipboard as Snapshot['clipboard'],
      activeTool: ui.getState().activeTool,
    };
  });
}

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

test.beforeEach(async ({ page, isMobile, browserName }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  // Every test in this worker shares one browser, and so one OS clipboard.
  // copy() mirrors to it asynchronously; an image left behind by an earlier
  // test would leak into this test's paste-back matching. Start clean.
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText(''));
  }
});

test('paste after a Delete on another layer still lands at the copied offset, not 0,0', async ({ page }) => {
  await createDocument(page, 800, 600, true);
  await page.waitForTimeout(300);

  const initial = await getSnapshot(page);
  const layer1Id = initial.document.activeLayerId;

  // 1. Layer 1: marquee + fill black, then deselect.
  await selectRect(page, 300, 200, 120, 90);
  await fillSelection(page, 0, 0, 0);
  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  // 2. Marquee a slightly larger region covering the fill and copy it.
  await selectRect(page, 280, 180, 160, 130);
  const toolBeforeCopy = (await getSnapshot(page)).activeTool;
  await page.keyboard.press(`${mod}+KeyC`);
  await page.waitForTimeout(200);

  const afterCopy = await getSnapshot(page);
  expect(afterCopy.clipboard).not.toBeNull();
  const offsetX = afterCopy.clipboard!.offsetX;
  const offsetY = afterCopy.clipboard!.offsetY;
  // Marquee drag coordinates land within a couple pixels of the requested
  // doc coordinates once projected through screen space and back.
  expect(offsetX).toBeGreaterThanOrEqual(275);
  expect(offsetX).toBeLessThanOrEqual(285);
  expect(offsetY).toBeGreaterThanOrEqual(175);
  expect(offsetY).toBeLessThanOrEqual(185);

  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  // 3. Add a second layer, marquee an unrelated area, and Delete/clear it.
  //    This is the step that must NOT disturb the internal clipboard.
  await addLayer(page);
  const layer2Id = (await getSnapshot(page)).document.activeLayerId;
  expect(layer2Id).not.toBe(layer1Id);

  await selectRect(page, 480, 280, 80, 50);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  // Clipboard record must be untouched by the Delete.
  const afterDelete = await getSnapshot(page);
  expect(afterDelete.clipboard).not.toBeNull();
  expect(afterDelete.clipboard!.offsetX).toBe(offsetX);
  expect(afterDelete.clipboard!.offsetY).toBe(offsetY);

  await page.screenshot({ path: 'e2e/screenshots/paste-after-delete-before-paste.png' });

  // 4. Select layer 1 again and paste — must land in place, not at 0,0.
  await setActiveLayer(page, layer1Id);
  await page.keyboard.press(`${mod}+KeyV`);
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'e2e/screenshots/paste-after-delete-after-paste.png' });

  const afterPaste = await getSnapshot(page);
  const pastedLayer = afterPaste.document.layers.find((l) => l.name === 'Pasted Layer');
  expect(pastedLayer).toBeDefined();

  // The bug: an intervening Delete made this land at (0, 0) via the
  // external-paste route. The fix: it pastes in place at the copied offset.
  expect(pastedLayer!.x).toBe(offsetX);
  expect(pastedLayer!.y).toBe(offsetY);
  expect(pastedLayer!.x).not.toBe(0);
  expect(pastedLayer!.y).not.toBe(0);

  // The external-paste route also force-switches to the Move tool; an
  // in-place paste must leave the active tool alone.
  expect(afterPaste.activeTool).toBe(toolBeforeCopy);
});

test('a Delete on the source layer itself also leaves the pending copy pasteable in place', async ({ page }) => {
  await createDocument(page, 800, 600, true);
  await page.waitForTimeout(300);

  const initial = await getSnapshot(page);
  const layer1Id = initial.document.activeLayerId;

  await selectRect(page, 300, 200, 120, 90);
  await fillSelection(page, 0, 0, 0);
  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  await selectRect(page, 280, 180, 160, 130);
  await page.keyboard.press(`${mod}+KeyC`);
  await page.waitForTimeout(200);

  const afterCopy = await getSnapshot(page);
  const offsetX = afterCopy.clipboard!.offsetX;
  const offsetY = afterCopy.clipboard!.offsetY;

  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  // Punch a hole inside the just-copied region, on the SAME layer the copy
  // came from, then deselect and paste.
  await setActiveLayer(page, layer1Id);
  await selectRect(page, 320, 220, 30, 30);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  await page.keyboard.press(`${mod}+KeyV`);
  await page.waitForTimeout(500);

  const afterPaste = await getSnapshot(page);
  const pastedLayer = afterPaste.document.layers.find((l) => l.name === 'Pasted Layer');
  expect(pastedLayer).toBeDefined();
  expect(pastedLayer!.x).toBe(offsetX);
  expect(pastedLayer!.y).toBe(offsetY);
});
