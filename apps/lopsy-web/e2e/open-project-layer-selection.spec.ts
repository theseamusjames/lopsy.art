/**
 * Open Project kept the layer selection of the throwaway document it builds
 * before loading: the selection named only that document's Background, an
 * id no loaded layer has. Delete Layer, which removes the selected layers,
 * then pushed a "Delete Layers" history row and removed nothing.
 */
import { test, expect, type Page } from './fixtures';
import { clickMenu, fillRect, historyLabels, openDocument, settle, surfaceState } from './surface-helpers';
import { captureDownload, watchDialogs } from './surface-helpers-file';

const RED = { r: 255, g: 0, b: 0 };

async function documentId(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __editorStore: { getState: () => { document: { id: string } } } }).__editorStore.getState().document.id,
  );
}

test('Delete Layer right after Open Project deletes the active layer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the menu bar needs the desktop layout');
  await openDocument(page);
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  await fillRect(page, 20, 20, 80, 60, RED);
  await page.keyboard.press('Control+d');
  const saved = await surfaceState(page);
  const activeId = saved.layers.find((l) => l.name === saved.activeLayerName)!.id;
  const bytes = (await captureDownload(page, () => clickMenu(page, 'File', 'Save Project'))).bytes;

  const oldId = await documentId(page);
  watchDialogs(page, true);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    clickMenu(page, 'File', 'Open Project...'),
  ]);
  await chooser.setFiles({ name: 'selection.lopsy', mimeType: 'application/octet-stream', buffer: bytes });
  await page.waitForFunction((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { id: string; layers: unknown[] } };
    };
    const doc = store.getState().document;
    return doc.id !== id && doc.layers.length > 0;
  }, oldId, { timeout: 20_000 });
  await settle(page, 500);

  const opened = await surfaceState(page);
  expect(opened.activeLayerName).toBe(saved.activeLayerName);
  expect(opened.layers.map((l) => l.id)).toContain(activeId);

  // No row is clicked first: the reopened document's own selection is used.
  await page.locator('[aria-label="Delete Layer"]').click();
  await settle(page);

  const after = await surfaceState(page);
  expect(after.layers.map((l) => l.id)).not.toContain(activeId);
  expect(after.layers.length).toBe(opened.layers.length - 1);
  expect(await historyLabels(page)).toContain('Delete Layers');
});
