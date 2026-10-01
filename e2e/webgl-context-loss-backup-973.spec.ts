import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, moveLayerTo, selectTool, setForegroundColor, waitForStore, getEditorState } from './helpers';

// #973: layer pixels are backed up to the CPU when the window loses focus,
// and restored behind a loading overlay after a WebGL context loss.

test.use({ allowConsoleErrors: [/\[Lopsy\] WebGL context lost/] });

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

/** The user switches to another window: the browser fires `blur`. */
async function leaveWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(200);
}

/** Record every loading-overlay message shown, so a brief overlay isn't missed. */
async function watchLoadingOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __overlaysSeen: string[] }).__overlaysSeen = seen;
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
        const label = el.getAttribute('aria-label');
        if (label && !seen.includes(label)) seen.push(label);
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function overlaysSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __overlaysSeen: string[] }).__overlaysSeen);
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

test.describe('WebGL context loss backup (#973)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'uses the desktop Edit menu');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('layers backed up on blur come back after a context loss, behind a loading overlay', async ({ page }) => {
    test.setTimeout(180_000);
    await setForegroundColor(page, 200, 0, 0);
    await marqueeFill(page, 50, 50, 150, 150);
    const red = await compositeAt(page, 100, 100);
    expect(red[0]).toBeGreaterThan(180);

    await leaveWindow(page);

    // Painted after the backup: this is lost with the context.
    await setForegroundColor(page, 0, 0, 220);
    await marqueeFill(page, 250, 100, 350, 200);
    expect((await compositeAt(page, 300, 150))[2]).toBeGreaterThan(180);

    await watchLoadingOverlay(page);
    await loseAndRestoreContext(page);

    expect(await overlaysSeen(page)).toContain('Restoring your layers after a graphics reset…');
    await expect(page.getByRole('dialog', { name: /Restoring your layers/ })).toHaveCount(0);

    const toasts = page.locator('[role="status"][aria-live="polite"]');
    await expect(toasts).toContainText('restored from the backup');
    await expect(toasts).toContainText('Layers were recovered from the backup');

    const back = await compositeAt(page, 100, 100);
    expect(back[0]).toBeGreaterThan(180);
    expect(back[2]).toBeLessThan(60);
    // The blue square painted after the backup is gone: white background.
    const lost = await compositeAt(page, 300, 150);
    expect(lost[0]).toBeGreaterThan(180);
    expect(lost[1]).toBeGreaterThan(180);

    // The restored layer is editable and undoable.
    await setForegroundColor(page, 0, 160, 0);
    await marqueeFill(page, 200, 20, 260, 80);
    const green = await compositeAt(page, 230, 50);
    expect(green[1]).toBeGreaterThan(130);
    expect(green[0]).toBeLessThan(60);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    // Back to the white background.
    expect((await compositeAt(page, 230, 50))[0]).toBeGreaterThan(180);
    expect((await compositeAt(page, 100, 100))[0]).toBeGreaterThan(180);
  });

  test('a layer moved after the backup goes back to where its backed-up pixels were', async ({ page }) => {
    test.setTimeout(180_000);
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 200, 0, 0);
    await marqueeFill(page, 50, 50, 150, 150);
    await leaveWindow(page);

    const before = (await getEditorState(page)).document.layers.find((l) => l.id === layerId)!;
    await moveLayerTo(page, layerId, before.x + 150, before.y + 100);
    expect((await compositeAt(page, 250, 200))[0]).toBeGreaterThan(180);
    expect((await compositeAt(page, 100, 100))[1]).toBeGreaterThan(180);

    await loseAndRestoreContext(page);

    // The move came after the backup, so the square is back at its old spot.
    const back = await compositeAt(page, 100, 100);
    expect(back[0]).toBeGreaterThan(180);
    expect(back[1]).toBeLessThan(60);
    expect((await compositeAt(page, 250, 200))[1]).toBeGreaterThan(180);
    const restored = (await getEditorState(page)).document.layers.find((l) => l.id === layerId)!;
    expect([restored.x, restored.y]).toEqual([before.x, before.y]);
  });

  test('without a backup the restore still warns that pixels could not be recovered', async ({ page }) => {
    test.setTimeout(120_000);
    await setForegroundColor(page, 200, 0, 0);
    await marqueeFill(page, 50, 50, 150, 150);
    await loseAndRestoreContext(page);
    const toasts = page.locator('[role="status"][aria-live="polite"]');
    await expect(toasts).toContainText('could not be recovered');
  });
});
