import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, selectTool, setForegroundColor, waitForStore } from './helpers';

// #973: a WebGL context loss wiped every layer with no warning, and ⌘Z after
// the restore threw "Invalid snapshot handle" because the undo stack still
// pointed at GPU textures from the lost context.

test.use({ allowConsoleErrors: [/\[Lopsy\] WebGL context lost/] });

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((h) => h.label);
  });
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
  const screen = await docToScreen(page, docX, docY);
  return page.evaluate(async ({ sx, sy }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const x = Math.round((sx - rect.left) * scale);
    const y = comp.height - 1 - Math.round((sy - rect.top) * scale);
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
  await page.waitForTimeout(1000);
}

test.describe('WebGL context loss (#973)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'uses the desktop Edit menu');
  });

  test('warns the user and leaves a working, error-free undo history', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await setForegroundColor(page, 200, 0, 0);
    await marqueeFill(page, 50, 50, 150, 150);
    expect((await historyLabels(page)).length).toBeGreaterThan(1);

    await loseAndRestoreContext(page);
    await page.screenshot({ path: 'e2e/screenshots/webgl-context-loss-973.png' });

    const toasts = page.locator('[role="status"][aria-live="polite"]').filter({ has: page.getByRole('button', { name: 'Dismiss' }) });
    await expect(toasts).toContainText('graphics context was lost');
    await expect(toasts).toContainText('Undo has been cleared');

    // The stale GPU snapshots are gone, so ⌘Z is a clean no-op instead of
    // throwing (the fixture fails the test on any page error).
    expect(await historyLabels(page)).toEqual([]);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // Work done after the restore is recorded and undoable again.
    await setForegroundColor(page, 0, 0, 220);
    await marqueeFill(page, 200, 100, 300, 200);
    const blue = await compositeAt(page, 250, 150);
    expect(blue[2]).toBeGreaterThan(180);
    expect(blue[0]).toBeLessThan(60);
    expect((await historyLabels(page)).length).toBeGreaterThan(0);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await compositeAt(page, 250, 150);
    expect(undone[2]! - undone[0]!).toBeLessThan(60);
  });
});
