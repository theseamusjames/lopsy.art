/**
 * Characterization: the File menu, item by item, as it behaves today.
 *
 * These specs pin what each item does (the unsaved-changes confirm, the
 * dialog or file chooser it opens, the download it starts and what is in it,
 * the document it leaves behind and its history) so the move onto the
 * command registry can be checked against them. Behaviour that looks wrong is
 * pinned as-is and says so. Disagreement ids (D14, D15, D16) refer to
 * docs/ui-surface-differences.md.
 *
 * The system file dialog itself cannot be driven headlessly; the specs answer
 * Playwright's `filechooser` event instead, which is where the app's
 * `<input type=file>.click()` lands.
 */
import { test, expect, type Page } from './fixtures';
import { getPixelAt } from './helpers';
import {
  clickMenu,
  fillRect,
  floatSelection,
  historyLabels,
  layerPixelHash,
  openDialogName,
  openDialogNames,
  openDocument,
  settle,
  surfaceState,
  toasts,
} from './surface-helpers';
import {
  captureDownload,
  decodeImageInPage,
  expectNoDownload,
  isDirty,
  makePngInPage,
  watchDialogs,
} from './surface-helpers-file';

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const UNSAVED = 'You have unsaved changes. Are you sure you want to continue?';
const OPEN_ACCEPT = '.jpg,.jpeg,.png,.gif,.bmp,.webp,.psd,.dng,.raf,.lopsy';

async function documentId(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __editorStore: { getState: () => { document: { id: string } } } }).__editorStore.getState().document.id,
  );
}

/** Count `filechooser` events while `trigger` runs and for a short wait after. */
async function fileChoosersDuring(page: Page, trigger: () => Promise<void>): Promise<number> {
  let count = 0;
  const onChooser = (): void => {
    count++;
  };
  page.on('filechooser', onChooser);
  try {
    await trigger();
    await settle(page, 800);
  } finally {
    page.off('filechooser', onChooser);
  }
  return count;
}

/** Wait until the document is replaced (its id differs from `oldId`) and has settled. */
async function waitForNewDocument(page: Page, oldId: string): Promise<void> {
  await page.waitForFunction((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { id: string; layers: unknown[] } };
    };
    const doc = store.getState().document;
    return doc.id !== id && doc.layers.length > 0;
  }, oldId, { timeout: 20_000 });
  await settle(page, 500);
}

async function saveProjectBytes(page: Page): Promise<Buffer> {
  const saved = await captureDownload(page, () => clickMenu(page, 'File', 'Save Project'));
  expect(saved.filename).toBe('lopsy.lopsy');
  return saved.bytes;
}

test.describe('File menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  // ---------------------------------------------------------------------------
  // New
  // ---------------------------------------------------------------------------

  test('D15: a freshly created document is already dirty, so New asks first; accepting opens "New Document"', async ({ page }) => {
    // Pinned as-is: createDocument's "New Document" history push sets isDirty,
    // so even an untouched new document triggers the unsaved-changes confirm.
    expect(await isDirty(page)).toBe(true);
    const dialogs = watchDialogs(page, true);

    await clickMenu(page, 'File', 'New');

    expect(dialogs.messages).toEqual([UNSAVED]);
    expect(dialogs.types).toEqual(['confirm']);
    expect(await openDialogNames(page)).toEqual(['New Document']);
    expect((await surfaceState(page)).modalKind).toBe('newDocument');
  });

  test('D15: New on a clean (saved) document opens "New Document" with no confirm; Cancel leaves the document', async ({ page }) => {
    await saveProjectBytes(page);
    expect(await isDirty(page)).toBe(false);
    const dialogs = watchDialogs(page, false);
    const id = await documentId(page);

    await clickMenu(page, 'File', 'New');

    expect(dialogs.messages).toEqual([]);
    expect(await openDialogNames(page)).toEqual(['New Document']);
    expect((await surfaceState(page)).modalKind).toBe('newDocument');

    await page.getByRole('dialog', { name: 'New Document' }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await settle(page);

    expect(await openDialogName(page)).toBeNull();
    expect((await surfaceState(page)).modalKind).toBeNull();
    expect(await documentId(page)).toBe(id);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await isDirty(page)).toBe(false);
  });

  test('New Document modal: Escape closes it and leaves the document', async ({ page }) => {
    watchDialogs(page, true);
    const id = await documentId(page);
    await clickMenu(page, 'File', 'New');
    expect(await openDialogName(page)).toBe('New Document');

    await page.keyboard.press('Escape');
    await settle(page);

    expect(await openDialogName(page)).toBeNull();
    expect((await surfaceState(page)).modalKind).toBeNull();
    expect(await documentId(page)).toBe(id);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('New Document modal: Create with typed sizes replaces the document, history is exactly ["New Document"]', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await page.keyboard.press('Control+d');
    const dialogs = watchDialogs(page, true);
    const id = await documentId(page);

    await clickMenu(page, 'File', 'New');
    expect(dialogs.messages).toEqual([UNSAVED]);
    const modal = page.getByRole('dialog', { name: 'New Document' });
    const sizes = modal.locator('input[type="number"]');
    await sizes.nth(0).fill('320');
    await sizes.nth(1).fill('240');
    await modal.getByRole('button', { name: 'Create', exact: true }).click();
    await waitForNewDocument(page, id);

    const s = await surfaceState(page);
    expect(await openDialogName(page)).toBeNull();
    expect(s.modalKind).toBeNull();
    expect({ w: s.docWidth, h: s.docHeight }).toEqual({ w: 320, h: 240 });
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect(s.activeLayerName).toBe('Layer 1');
    expect(s.selection.active).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document']);
    // Pinned as-is: the new document starts dirty (see the first test).
    expect(await isDirty(page)).toBe(true);
    // The old red fill is gone; the white background is new.
    expect((await getPixelAt(page, 50, 40)).a).toBe(0);
    const bg = s.layers.find((l) => l.name === 'Background')!;
    expect(await getPixelAt(page, 50, 40, bg.id)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  test('D15: New on a dirty document asks first; dismissing leaves the document and opens nothing', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    expect(await isDirty(page)).toBe(true);
    const id = await documentId(page);
    const hash = await layerPixelHash(page);
    const dialogs = watchDialogs(page, false);

    await clickMenu(page, 'File', 'New');

    expect(dialogs.messages).toEqual([UNSAVED]);
    expect(dialogs.types).toEqual(['confirm']);
    expect(await openDialogName(page)).toBeNull();
    expect((await surfaceState(page)).modalKind).toBeNull();
    expect(await documentId(page)).toBe(id);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await layerPixelHash(page)).toBe(hash);
    expect(await isDirty(page)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Open...
  // ---------------------------------------------------------------------------

  test('D14: Open... on a dirty document asks first; dismissing opens no chooser', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const id = await documentId(page);
    const dialogs = watchDialogs(page, false);

    const choosers = await fileChoosersDuring(page, () => clickMenu(page, 'File', 'Open...'));

    expect(dialogs.messages).toEqual([UNSAVED]);
    expect(choosers).toBe(0);
    expect(await documentId(page)).toBe(id);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
  });

  test('D14: Open... opens a chooser for images, PSD, raw and projects, and opens a PNG as a new document', async ({ page }) => {
    await saveProjectBytes(page);
    const dialogs = watchDialogs(page, true);
    const png = await makePngInPage(page, 64, 48, [{ x: 10, y: 8, width: 20, height: 12, rgb: BLUE }]);
    const id = await documentId(page);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickMenu(page, 'File', 'Open...'),
    ]);
    expect(dialogs.messages).toEqual([]);
    expect(chooser.isMultiple()).toBe(false);
    expect(await chooser.element().evaluate((el) => (el as HTMLInputElement).accept)).toBe(OPEN_ACCEPT);

    await chooser.setFiles({ name: 'probe.png', mimeType: 'image/png', buffer: png });
    await waitForNewDocument(page, id);

    const s = await surfaceState(page);
    expect({ w: s.docWidth, h: s.docHeight }).toEqual({ w: 64, h: 48 });
    expect(s.orderNames).toEqual(['Background', 'Project']);
    expect(s.activeLayerName).toBe('Background');
    expect(await page.evaluate(() =>
      (window as unknown as { __editorStore: { getState: () => { document: { name: string } } } }).__editorStore.getState().document.name,
    )).toBe('probe');
    // The opened image's history starts with a "New Document" row, and, as
    // with a created document, it counts as dirty (pinned as-is).
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await isDirty(page)).toBe(true);
    expect(await getPixelAt(page, 15, 12)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    expect(await getPixelAt(page, 50, 40)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(await toasts(page)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Save Project / Open Project...
  // ---------------------------------------------------------------------------

  test('Save Project downloads lopsy.lopsy and marks the document clean, so New asks nothing', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    expect(await isDirty(page)).toBe(true);

    const bytes = await saveProjectBytes(page);
    expect(bytes.length).toBeGreaterThan(100);
    expect(await isDirty(page)).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await toasts(page)).toEqual([]);

    const dialogs = watchDialogs(page, false);
    await clickMenu(page, 'File', 'New');
    expect(dialogs.messages).toEqual([]);
    expect(await openDialogName(page)).toBe('New Document');
  });

  test('Open Project... on a dirty document asks first; dismissing opens no chooser', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const dialogs = watchDialogs(page, false);

    const choosers = await fileChoosersDuring(page, () => clickMenu(page, 'File', 'Open Project...'));

    expect(dialogs.messages).toEqual([UNSAVED]);
    expect(choosers).toBe(0);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
  });

  test('Open Project... round-trips a saved project: layers, names and pixels survive', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await page.keyboard.press('Control+d');
    await page.locator('[aria-label="Add Layer"]').click();
    await settle(page);
    await fillRect(page, 100, 70, 150, 120, BLUE);
    await page.keyboard.press('Control+d');
    const saved = await surfaceState(page);
    expect(saved.orderNames).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    const layer1 = saved.layers.find((l) => l.name === 'Layer 1')!.id;
    const layer2 = saved.layers.find((l) => l.name === 'Layer 2')!.id;
    const bytes = await saveProjectBytes(page);

    // Replace the document so the reopen has something to undo.
    const savedId = await documentId(page);
    await clickMenu(page, 'File', 'New');
    await page.getByRole('dialog', { name: 'New Document' }).getByRole('button', { name: 'Create', exact: true }).click();
    await waitForNewDocument(page, savedId);
    const dialogs = watchDialogs(page, true);
    const blankId = await documentId(page);
    expect((await surfaceState(page)).docWidth).toBe(1920);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickMenu(page, 'File', 'Open Project...'),
    ]);
    // The freshly created document counts as dirty, so it asks first.
    expect(dialogs.messages).toEqual([UNSAVED]);
    expect(await chooser.element().evaluate((el) => (el as HTMLInputElement).accept)).toBe('.lopsy');
    await chooser.setFiles({ name: 'roundtrip.lopsy', mimeType: 'application/octet-stream', buffer: bytes });
    await waitForNewDocument(page, blankId);

    const s = await surfaceState(page);
    expect({ w: s.docWidth, h: s.docHeight }).toEqual({ w: 200, h: 150 });
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    expect(s.layers.map((l) => l.type)).toEqual(saved.layers.map((l) => l.type));
    expect(s.activeLayerName).toBe('Layer 2');
    // Pinned as-is: a just-opened project is dirty, like a created document.
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await isDirty(page)).toBe(true);
    const l1 = s.layers.find((l) => l.name === 'Layer 1')!.id;
    const l2 = s.layers.find((l) => l.name === 'Layer 2')!.id;
    // Layer ids survive the round trip.
    expect(s.layerOrder).toEqual(saved.layerOrder);
    expect({ l1, l2 }).toEqual({ l1: layer1, l2: layer2 });
    expect(await getPixelAt(page, 50, 40, l1)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect((await getPixelAt(page, 125, 95, l1)).a).toBe(0);
    expect(await getPixelAt(page, 125, 95, l2)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    expect((await getPixelAt(page, 50, 40, l2)).a).toBe(0);
    expect(await toasts(page)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Export…
  // ---------------------------------------------------------------------------

  test('Export… opens "Export"; Export with a typed filename downloads that PNG at the document size', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await page.keyboard.press('Control+d');

    await clickMenu(page, 'File', 'Export…');
    expect(await openDialogNames(page)).toEqual(['Export']);
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog.getByText('200 × 150 px')).toBeVisible();
    const filename = dialog.locator('#export-filename');
    await expect(filename).toHaveValue('lopsy');
    await filename.fill('typed-name');

    const out = await captureDownload(page, () => dialog.getByRole('button', { name: 'Export', exact: true }).click());

    expect(out.filename).toBe('typed-name.png');
    const img = await decodeImageInPage(page, out.bytes, [{ x: 50, y: 40 }, { x: 150, y: 120 }]);
    expect({ w: img.width, h: img.height }).toEqual({ w: 200, h: 150 });
    expect(img.probes[0]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(img.probes[1]).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    // The download marks the document clean.
    expect(await isDirty(page)).toBe(false);
  });

  test('Export… Cancel closes the dialog and downloads nothing', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await clickMenu(page, 'File', 'Export…');
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog).toBeVisible();

    await expectNoDownload(page, () => dialog.getByRole('button', { name: 'Cancel', exact: true }).click());

    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await isDirty(page)).toBe(true);
  });

  test('D16: opening Export… with a live Move float, then Cancel, leaves the float as it is', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
    const floating = await surfaceState(page);
    expect(floating.hasFloat).toBe(true);
    const hash = await layerPixelHash(page, layer);

    await clickMenu(page, 'File', 'Export…');
    const dialog = page.getByRole('dialog', { name: 'Export' });
    // Wait for the preview composite, which is what runs the commits.
    await expect(dialog.getByRole('img', { name: 'Export preview' })).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await settle(page);

    const s = await surfaceState(page);
    // commitLayerTransform() commits the multi-layer transform only; the Move
    // float is a different thing and survives the dialog.
    expect(s.hasFloat).toBe(true);
    expect(s.hasTransform).toBe(true);
    expect(s.hasLayerTransform).toBe(false);
    expect(s.selection.bounds).toEqual(floating.selection.bounds);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);
    expect(await layerPixelHash(page, layer)).toBe(hash);
    expect(await getPixelAt(page, 100, 60, layer)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  // ---------------------------------------------------------------------------
  // Quick Export PNG / Export PSD
  // ---------------------------------------------------------------------------

  test('Quick Export PNG downloads lopsy.png at the document size with the painted pixels', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await page.keyboard.press('Control+d');

    const out = await captureDownload(page, () => clickMenu(page, 'File', 'Quick Export PNG'));

    expect(out.filename).toBe('lopsy.png');
    const img = await decodeImageInPage(page, out.bytes, [{ x: 50, y: 40 }, { x: 21, y: 21 }, { x: 10, y: 10 }, { x: 150, y: 120 }]);
    expect({ w: img.width, h: img.height }).toEqual({ w: 200, h: 150 });
    expect(img.probes[0]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(img.probes[1]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(img.probes[2]).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(img.probes[3]).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await isDirty(page)).toBe(false);
    expect(await toasts(page)).toEqual([]);
  });

  test('Export PSD downloads lopsy.psd, a non-empty 8BPS file, and marks the document clean', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await page.keyboard.press('Control+d');

    const out = await captureDownload(page, () => clickMenu(page, 'File', 'Export PSD'));

    expect(out.filename).toBe('lopsy.psd');
    expect(out.bytes.length).toBeGreaterThan(1000);
    expect(out.bytes.subarray(0, 4).toString('latin1')).toBe('8BPS');
    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await isDirty(page)).toBe(false);
    expect(await toasts(page)).toEqual([]);
  });
});
