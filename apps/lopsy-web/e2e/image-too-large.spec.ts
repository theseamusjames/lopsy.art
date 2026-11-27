import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { createDocument, waitForStore } from './helpers';
import { clickMenu, closeMenus, menuItem, toasts } from './surface-helpers';
import { makePngInPage, watchDialogs } from './surface-helpers-file';
import { isWgpu } from './gpu-args';

/**
 * An image or project larger than this device can hold (every layer is one
 * texture, so a side is at most the GPU's largest texture, or Lopsy's own
 * 16,384) is not opened: one message, centred over the canvas (over the
 * start screen before there is one), says so and why; no toast; the
 * document that was open, or the start screen, is exactly as it was, with
 * no console errors (the fixture fails a test on any). An image at the
 * limit opens as before.
 *
 * The limit is read from the page's GPU (8,192 on SwiftShader, the suite's),
 * and the files are made in the page a few pixels larger: small files that
 * are too large.
 */

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'File > Open and the canvas area need the desktop layout');
});

/** The largest document side here: the GPU's largest texture as the running engine has it, at most 16,384. */
async function documentLimit(page: Page): Promise<number> {
  const gpu = await page.evaluate(async (wgpu) => {
    if (wgpu) {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<{ limits: { maxTextureDimension2D: number } } | null> } }).gpu.requestAdapter();
      return adapter?.limits.maxTextureDimension2D ?? 0;
    }
    const gl = document.createElement('canvas').getContext('webgl2');
    const size = gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number | undefined;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return size ?? 0;
  }, isWgpu);
  expect(gpu).toBeGreaterThan(0);
  return Math.min(gpu, 16384);
}

const count = (n: number) => n.toLocaleString('en-US');

/** The body the message gives for an image named `name` (null: none) of `width` × `height` at `limit`. */
function expectedBody(who: string, width: number, height: number, limit: number, next: string): string {
  return (
    `${who} is ${count(width)} × ${count(height)} pixels. Lopsy keeps each layer as one image in this device's graphics memory, ` +
    `and the largest this device allows is ${count(limit)} pixels on a side. ${next}`
  );
}

function message(page: Page): Locator {
  return page.getByRole('alertdialog');
}

async function jpegInPage(page: Page, width: number, height: number): Promise<Buffer> {
  const data = await page.evaluate(async ({ w, h }) => {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = 'rgb(40,120,200)';
    ctx.fillRect(0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { w: width, h: height });
  return Buffer.from(data);
}

/** The editor's document as far as opening could change it. */
async function documentState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        documentReady: boolean;
        documentVersion: number;
        undoStack: Array<{ label: string }>;
        document: { id: string; name: string; width: number; height: number; layers: Array<{ id: string; name: string; width: number; height: number }> };
      };
    };
    const s = store.getState();
    return {
      documentReady: s.documentReady,
      documentVersion: s.documentVersion,
      history: s.undoStack.map((e) => e.label),
      id: s.document.id,
      name: s.document.name,
      width: s.document.width,
      height: s.document.height,
      layers: s.document.layers.map((l) => `${l.id} ${l.name} ${l.width}x${l.height}`),
    };
  });
}

async function openWithFileMenu(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickMenu(page, 'File', 'Open...')]);
  await chooser.setFiles(file);
}

/** Drops `bytes` as a file on the canvas, as a user dragging it from the desktop does. */
async function dropOnCanvas(page: Page, name: string, type: string, bytes: Buffer): Promise<void> {
  await page.evaluate(({ data, fileName, mime }) => {
    const file = new File([new Uint8Array(data)], fileName, { type: mime });
    const target = document.querySelector('[data-testid="canvas-container"]');
    if (!target) throw new Error('no canvas container');
    const dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, { data: Array.from(bytes), fileName: name, mime: type });
}

/**
 * Pastes an image as ⌘V does with one on the clipboard: the browser's paste
 * event carrying it (not the shared system clipboard, which other workers
 * write to).
 */
async function pasteImage(page: Page, type: string, bytes: Buffer): Promise<void> {
  await page.evaluate(({ data, mime }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], '', { type: mime }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { data: Array.from(bytes), mime: type });
}

/** Checks the message is centred over `area`'s box. */
async function expectCentredOver(page: Page, area: Locator): Promise<void> {
  const box = await message(page).boundingBox();
  const over = await area.boundingBox();
  if (!box || !over) throw new Error('not laid out');
  expect(Math.abs(box.x + box.width / 2 - (over.x + over.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height / 2 - (over.y + over.height / 2))).toBeLessThanOrEqual(1);
}

test.describe('an image too large for this device', () => {
  test.describe.configure({ timeout: 120_000 });

  test('File > Open...: the message over the canvas says why, nothing changes, and an image at the limit opens', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 300, 200);
    // A new document is dirty: File > Open... asks first, and the test says yes.
    watchDialogs(page, true);
    const limit = await documentLimit(page);
    const before = await documentState(page);

    const tooLarge = await makePngInPage(page, limit + 8, 64, []);
    await openWithFileMenu(page, { name: 'ultrawide.png', mimeType: 'image/png', buffer: tooLarge });

    const shown = message(page);
    await expect(shown).toBeVisible({ timeout: 20_000 });
    await expect(shown).toHaveAccessibleName('This image is too large to open');
    await expect(shown).toHaveAccessibleDescription(expectedBody('ultrawide.png', limit + 8, 64, limit, 'Make the image smaller and open it again.'));
    await expectCentredOver(page, page.getByTestId('canvas-container'));
    await expect(shown.getByRole('button', { name: 'OK' })).toBeFocused();
    await page.screenshot({ path: 'e2e/screenshots/image-too-large-open.png' });
    expect(await toasts(page)).toEqual([]);
    expect(await documentState(page)).toEqual(before);

    // The menus still work while it shows.
    await expect(await menuItem(page, 'File', 'Open...')).toBeVisible();
    await closeMenus(page);
    await expect(shown).toBeVisible();

    // OK dismisses it.
    await shown.getByRole('button', { name: 'OK' }).click();
    await expect(shown).toHaveCount(0);

    // An image at the limit opens as it always did, replacing the document.
    const atLimit = await makePngInPage(page, limit, 64, [{ x: 0, y: 0, width: 32, height: 64, rgb: { r: 255, g: 0, b: 0 } }]);
    await openWithFileMenu(page, { name: 'at-limit.png', mimeType: 'image/png', buffer: atLimit });
    await expect.poll(async () => (await documentState(page)).width, { timeout: 20_000 }).toBe(limit);
    const opened = await documentState(page);
    expect(opened).toMatchObject({ width: limit, height: 64, name: 'at-limit' });
    expect(opened.id).not.toBe(before.id);
    await expect(shown).toHaveCount(0);
    expect(await toasts(page)).toEqual([]);
  });

  test('a drop and a paste onto an open document: the message says why, no layer is added, Escape dismisses it', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 300, 200);
    const limit = await documentLimit(page);
    const before = await documentState(page);

    // A PNG, refused from its header.
    await dropOnCanvas(page, 'wide.png', 'image/png', await makePngInPage(page, limit + 8, 64, []));
    const shown = message(page);
    await expect(shown).toBeVisible({ timeout: 20_000 });
    await expect(shown).toHaveAccessibleName('This image is too large to open');
    await expect(shown).toHaveAccessibleDescription(expectedBody('wide.png', limit + 8, 64, limit, 'Make the image smaller and open it again.'));
    await expectCentredOver(page, page.getByTestId('canvas-container'));
    expect(await toasts(page)).toEqual([]);
    expect(await documentState(page)).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(shown).toHaveCount(0);

    // A JPEG pasted from the clipboard, refused from the browser's decode.
    await pasteImage(page, 'image/jpeg', await jpegInPage(page, 64, limit + 8));
    await expect(shown).toBeVisible({ timeout: 20_000 });
    await expect(shown).toHaveAccessibleName('This image is too large to paste');
    await expect(shown).toHaveAccessibleDescription(expectedBody('The pasted image', 64, limit + 8, limit, 'Make the image smaller and paste it again.'));
    await page.screenshot({ path: 'e2e/screenshots/image-too-large-paste.png' });
    expect(await toasts(page)).toEqual([]);
    expect(await documentState(page)).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(shown).toHaveCount(0);

    // An image that fits still drops in as a layer.
    await dropOnCanvas(page, 'small.png', 'image/png', await makePngInPage(page, 40, 30, []));
    await expect.poll(async () => (await documentState(page)).layers.length, { timeout: 20_000 }).toBe(before.layers.length + 1);
    await expect(shown).toHaveCount(0);
  });

  test("File > New's Open File…: the dialog closes, so the message over the canvas is not under it, and nothing changes", async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 300, 200);
    watchDialogs(page, true);
    const limit = await documentLimit(page);
    const before = await documentState(page);

    await clickMenu(page, 'File', 'New');
    const dialog = page.getByRole('dialog', { name: 'New Document' });
    await expect(dialog).toBeVisible();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: 'Open File…' }).click()]);
    await chooser.setFiles({ name: 'wide.png', mimeType: 'image/png', buffer: await makePngInPage(page, limit + 8, 64, []) });

    const shown = message(page);
    await expect(shown).toBeVisible({ timeout: 20_000 });
    await expect(shown).toHaveAccessibleDescription(expectedBody('wide.png', limit + 8, 64, limit, 'Make the image smaller and open it again.'));
    await expect(dialog).toHaveCount(0);
    expect(await toasts(page)).toEqual([]);
    expect(await documentState(page)).toEqual(before);
  });

  test('the start screen: Open File… keeps the start screen and says why; an image that fits then opens', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible({ timeout: 15_000 });
    const limit = await documentLimit(page);

    const openFile = page.getByRole('button', { name: 'Open File…' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), openFile.click()]);
    await chooser.setFiles({ name: 'tall.jpg', mimeType: 'image/jpeg', buffer: await jpegInPage(page, 64, limit + 8) });

    const shown = message(page);
    await expect(shown).toBeVisible({ timeout: 20_000 });
    await expect(shown).toHaveAccessibleName('This image is too large to open');
    await expect(shown).toHaveAccessibleDescription(expectedBody('tall.jpg', 64, limit + 8, limit, 'Make the image smaller and open it again.'));
    await expectCentredOver(page, page.locator('body'));
    await page.screenshot({ path: 'e2e/screenshots/image-too-large-start-screen.png' });
    expect(await toasts(page)).toEqual([]);
    expect((await documentState(page)).documentReady).toBe(false);
    await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();

    // Dismissed, focus goes back to the button that opened the file.
    await shown.getByRole('button', { name: 'OK' }).click();
    await expect(shown).toHaveCount(0);
    await expect(openFile).toBeFocused();

    const [again] = await Promise.all([page.waitForEvent('filechooser'), openFile.click()]);
    await again.setFiles({ name: 'fits.png', mimeType: 'image/png', buffer: await makePngInPage(page, 120, 80, []) });
    await expect.poll(async () => (await documentState(page)).documentReady, { timeout: 20_000 }).toBe(true);
    expect(await documentState(page)).toMatchObject({ width: 120, height: 80 });
    await expect(shown).toHaveCount(0);
  });

  test('a project larger than this device allows is not opened, and the message says so', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 300, 200);
    const limit = await documentLimit(page);
    const before = await documentState(page);
    watchDialogs(page, true);

    // The 64 × 16 v2 fixture with its document made wider than the limit: the manifest is
    // the JSON after the 12-byte header, its length at byte 8.
    const fixture = readFileSync('e2e/fixtures/project-v2-ramp.lopsy');
    const manifestLength = fixture.readUInt32LE(8);
    const manifest = JSON.parse(fixture.subarray(12, 12 + manifestLength).toString('utf8')) as Record<string, unknown>;
    expect(manifest.documentWidth).toBe(64);
    const wider = Buffer.from(JSON.stringify({ ...manifest, documentWidth: limit + 8 }), 'utf8');
    const header = Buffer.from(fixture.subarray(0, 12));
    header.writeUInt32LE(wider.length, 8);
    const project = Buffer.concat([header, wider, fixture.subarray(12 + manifestLength)]);

    await openWithFileMenu(page, { name: 'poster.lopsy', mimeType: 'application/octet-stream', buffer: project });
    const shown = message(page);
    await expect(shown).toBeVisible({ timeout: 20_000 });
    await expect(shown).toHaveAccessibleName('This project is too large to open');
    await expect(shown).toHaveAccessibleDescription(
      expectedBody('poster.lopsy', limit + 8, 16, limit, 'Open it on a device whose graphics allow larger images.'),
    );
    expect(await toasts(page)).toEqual([]);
    expect(await documentState(page)).toEqual(before);

    // The unmodified project opens, and the message goes with the old document.
    await openWithFileMenu(page, { name: 'ramp.lopsy', mimeType: 'application/octet-stream', buffer: fixture });
    await expect.poll(async () => (await documentState(page)).width, { timeout: 20_000 }).toBe(64);
    await expect(shown).toHaveCount(0);
  });
});
