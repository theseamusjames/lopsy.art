import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  selectTool,
  docToScreen,
  getPixelAt,
  getEditorState,
  setForegroundColor,
} from './helpers';

// #1005: every pixel edit allocates a GPU snapshot texture. Before the fix
// none were ever released — not when the 50-state cap trimmed an entry, not
// when a push discarded the redo stack, not on File → New — so GPU memory
// grew with every edit until the context was lost. The engine's live
// snapshot count must equal the number of distinct handles history still
// references.

interface SnapshotStats {
  engineLive: number;
  referenced: number;
  undo: number;
  redo: number;
}

async function snapshotStats(page: Page): Promise<SnapshotStats> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __gpuSnapshotCount: () => number;
      __editorStore: {
        getState: () => {
          undoStack: Array<{ kind: string; gpuSnapshots?: Map<string, number>; maskSnapshots?: Map<string, { handle: number }> }>;
          redoStack: Array<{ kind: string; gpuSnapshots?: Map<string, number>; maskSnapshots?: Map<string, { handle: number }> }>;
        };
      };
    };
    const s = w.__editorStore.getState();
    const refs = new Set<number>();
    for (const e of [...s.undoStack, ...s.redoStack]) {
      if (e.kind !== 'pixels') continue;
      for (const h of e.gpuSnapshots?.values() ?? []) if (h !== 0xFFFFFFFF) refs.add(h);
      for (const m of e.maskSnapshots?.values() ?? []) if (m.handle !== 0xFFFFFFFF) refs.add(m.handle);
    }
    return {
      engineLive: w.__gpuSnapshotCount(),
      referenced: refs.size,
      undo: s.undoStack.length,
      redo: s.redoStack.length,
    };
  });
}

async function marquee(page: Page, x: number, y: number, w: number, h: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  const start = await docToScreen(page, x, y);
  const end = await docToScreen(page, x + w, y + h);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}

async function editFill(page: Page): Promise<void> {
  await page.locator('button:has-text("Edit")').first().click();
  await page.getByRole('menuitem', { name: /^Fill(\s*⇧F5)?$/ }).click();
}

async function fillTimes(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await editFill(page);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

test.describe('Undo snapshot textures are released (#1005)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar requires desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await settle(page);
  });

  test('entries trimmed off the 50-state cap free their textures, and undo still works', async ({ page }) => {
    const layerId = await addLayer(page);
    await setForegroundColor(page, 255, 0, 0);
    await marquee(page, 100, 80, 120, 90);
    await fillTimes(page, 60);
    await settle(page);

    const stats = await snapshotStats(page);
    expect(stats.undo).toBe(50);
    // Pre-fix: ~62 textures stayed allocated for ~52 referenced handles.
    expect(stats.engineLive).toBe(stats.referenced);

    await page.screenshot({ path: 'e2e/screenshots/undo-snapshot-release-filled.png' });
    expect(await getPixelAt(page, 150, 120, layerId)).toMatchObject({ r: 255, g: 0, b: 0, a: 255 });

    for (let i = 0; i < 50; i++) await page.keyboard.press('Control+z');
    await settle(page);
    const afterUndo = await snapshotStats(page);
    expect(afterUndo.undo).toBe(0);
    expect(afterUndo.redo).toBe(50);
    // The oldest retained state is already filled (the unfilled states were
    // trimmed), so undoing all the way still shows red — restores from the
    // surviving handles must not have been freed.
    expect(await getPixelAt(page, 150, 120, layerId)).toMatchObject({ r: 255, g: 0, b: 0, a: 255 });
    expect(afterUndo.engineLive).toBeLessThanOrEqual(afterUndo.referenced + 1);
  });

  test('a new edit after undo frees the discarded redo states', async ({ page }) => {
    const layerId = await addLayer(page);
    await setForegroundColor(page, 0, 0, 255);
    await marquee(page, 40, 40, 100, 100);
    await fillTimes(page, 10);
    for (let i = 0; i < 8; i++) await page.keyboard.press('Control+z');
    await settle(page);
    const beforePush = await snapshotStats(page);
    expect(beforePush.redo).toBe(8);

    await setForegroundColor(page, 0, 255, 0);
    await editFill(page);
    await settle(page);

    const stats = await snapshotStats(page);
    expect(stats.redo).toBe(0);
    expect(stats.engineLive).toBe(stats.referenced);
    expect(stats.engineLive).toBeLessThan(beforePush.engineLive);
    expect(await getPixelAt(page, 90, 90, layerId)).toMatchObject({ r: 0, g: 255, b: 0, a: 255 });
  });

  test('File → New frees the previous document\'s history textures', async ({ page }) => {
    await addLayer(page);
    await marquee(page, 20, 20, 200, 150);
    await fillTimes(page, 20);
    await settle(page);
    expect((await snapshotStats(page)).engineLive).toBeGreaterThan(20);

    page.once('dialog', (d) => void d.accept());
    await page.locator('button:has-text("File")').first().click();
    await page.getByRole('menuitem', { name: /^New/ }).first().click();
    const modal = page.getByRole('dialog', { name: 'New Document' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Create' }).click();
    await expect(modal).toBeHidden();
    await expect.poll(async () => (await getEditorState(page)).undoStackLength).toBeGreaterThan(0);
    await settle(page);

    const stats = await snapshotStats(page);
    // Only the new document's baseline "New Document" entry is left, one
    // texture per raster layer. Pre-fix every old texture was still live.
    expect(stats.engineLive).toBe(stats.referenced);
    expect(stats.engineLive).toBeLessThanOrEqual(3);
  });

  test('Move-tool arrow nudges past the cap free their full-layer copies', async ({ page }) => {
    await addLayer(page);
    await marquee(page, 100, 100, 60, 40);
    await editFill(page);
    await page.keyboard.press('Control+d');
    await selectTool(page, 'move');
    await settle(page);

    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowDown');
    await settle(page);

    const stats = await snapshotStats(page);
    expect(stats.undo).toBe(50);
    expect(stats.engineLive).toBe(stats.referenced);
  });
});
