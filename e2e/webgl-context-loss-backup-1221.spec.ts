import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, getEditorState, selectTool, setForegroundColor, waitForStore } from './helpers';

// #1221: leaving the window re-reads only the layers changed since the last
// context-loss backup, in idle slices. #1222: a document over the backup cap
// is not read again until it changes, nor when its unchanged layers alone
// are known to exceed the cap.

test.use({ allowConsoleErrors: [/\[Lopsy\] WebGL context lost/] });

interface BackupStats {
  reads: number;
  committed: number;
  tooLarge: number;
  isPassPending: boolean;
}

async function backupStats(page: Page): Promise<BackupStats> {
  return page.evaluate(() => (window as unknown as { __layerBackupStats: () => BackupStats }).__layerBackupStats());
}

async function setBackupCap(page: Page, bytes: number | null): Promise<void> {
  await page.evaluate((b) => {
    (window as unknown as { __setLayerBackupMaxBytes: (n: number | null) => void }).__setLayerBackupMaxBytes(b);
  }, bytes);
}

/** The user switches to another window; wait for the sliced backup to settle. */
async function leaveWindow(page: Page): Promise<BackupStats> {
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(async () => (await backupStats(page)).isPassPending, { timeout: 10_000 }).toBe(false);
  return backupStats(page);
}

async function dragDoc(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function marqueeFill(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, [x0, y0], [x1, y1]);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

async function compositeAt(page: Page, docX: number, docY: number): Promise<number[]> {
  const screen = await docToScreen(page, docX + 0.5, docY + 0.5);
  return page.evaluate(async ({ sx, sy }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const x = Math.floor((sx - rect.left) * scale);
    const y = comp.height - 1 - Math.floor((sy - rect.top) * scale);
    const i = (y * comp.width + x) * 4;
    return comp.pixels.slice(i, i + 4);
  }, { sx: screen.x, sy: screen.y });
}

async function loseAndRestoreContext(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.querySelector('[data-testid="canvas-container"] canvas') as HTMLCanvasElement;
    const ext = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    const restored = new Promise<void>((resolve) => {
      canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true });
    });
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    ext.restoreContext();
    await restored;
  });
  await page.waitForTimeout(1500);
}

/** Two painted layers over the background: red on the first, blue on the active second. */
async function paintTwoLayers(page: Page): Promise<void> {
  await addLayer(page);
  await setForegroundColor(page, 200, 0, 0);
  await marqueeFill(page, 40, 40, 140, 140);
  await addLayer(page);
  await setForegroundColor(page, 0, 0, 220);
  await marqueeFill(page, 240, 40, 340, 140);
}

test.describe('Incremental context-loss backup (#1221, #1222)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'uses the desktop Edit menu');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('a blur after editing one layer re-reads only that layer, and the restore still has every layer', async ({ page }) => {
    test.setTimeout(180_000);
    await paintTwoLayers(page);

    const pixelLayers = (await getEditorState(page)).document.layers
      .filter((l) => l.type === 'raster' || l.type === 'text');
    expect(pixelLayers.length).toBeGreaterThanOrEqual(3);

    const first = await leaveWindow(page);
    expect(first.committed).toBe(1);
    expect(first.reads).toBe(pixelLayers.length);

    // Paint again on the active (blue) layer only.
    await setForegroundColor(page, 0, 160, 0);
    await marqueeFill(page, 160, 180, 260, 260);
    const second = await leaveWindow(page);
    expect(second.committed).toBe(2);
    expect(second.reads - first.reads).toBe(1);

    // Nothing changed since: nothing is read.
    const third = await leaveWindow(page);
    expect(third.reads).toBe(second.reads);
    expect(third.committed).toBe(2);

    await loseAndRestoreContext(page);
    const toasts = page.locator('[role="status"][aria-live="polite"]');
    await expect(toasts).toContainText('Layers were recovered from the backup');

    // The red layer's blob was reused from the first backup, the blue
    // layer's re-read in the second: both come back, with the green square.
    const red = await compositeAt(page, 90, 90);
    expect(red[0]).toBeGreaterThan(180);
    expect(red[2]).toBeLessThan(60);
    const blue = await compositeAt(page, 290, 90);
    expect(blue[2]).toBeGreaterThan(180);
    expect(blue[0]).toBeLessThan(60);
    const green = await compositeAt(page, 210, 220);
    expect(green[1]).toBeGreaterThan(130);
    expect(green[0]).toBeLessThan(60);
    // Untouched background stays white.
    const white = await compositeAt(page, 30, 280);
    expect(Math.min(white[0]!, white[1]!, white[2]!)).toBeGreaterThan(220);
  });

  test('an over-cap document is not read again until a backup can fit', async ({ page }) => {
    test.setTimeout(180_000);
    await paintTwoLayers(page);
    await setBackupCap(page, 64);

    const over = await leaveWindow(page);
    expect(over.tooLarge).toBe(1);
    expect(over.committed).toBe(0);
    expect(over.reads).toBeGreaterThan(0);

    // No edit since: the failure is remembered and nothing is read.
    const again = await leaveWindow(page);
    expect(again.reads).toBe(over.reads);
    expect(again.tooLarge).toBe(1);

    // A new layer changes the history key, but the painted layers' known
    // sizes alone exceed the cap: skipped without a readback.
    await addLayer(page);
    const grown = await leaveWindow(page);
    expect(grown.reads).toBe(over.reads);
    expect(grown.tooLarge).toBe(2);
    expect(grown.committed).toBe(0);

    await setBackupCap(page, null);
    await setForegroundColor(page, 0, 160, 0);
    await marqueeFill(page, 160, 180, 260, 260);
    const fits = await leaveWindow(page);
    expect(fits.committed).toBe(1);

    await loseAndRestoreContext(page);
    const red = await compositeAt(page, 90, 90);
    expect(red[0]).toBeGreaterThan(180);
    expect(red[2]).toBeLessThan(60);
    const green = await compositeAt(page, 210, 220);
    expect(green[1]).toBeGreaterThan(130);
  });
});
