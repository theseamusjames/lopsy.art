import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, setToolOption, waitForStore } from './helpers';

// #1088: the context-loss backup (#973) skipped text layers, assuming they
// re-render from their model — but nothing re-rendered them on the fresh
// engine, so every live text layer came back blank.

test.use({ allowConsoleErrors: [/\[Lopsy\] WebGL context lost/] });

interface TextRead { id: string; x: number; y: number; width: number; height: number; glyph: [number, number] | null; opaque: number }

async function readText(page: Page): Promise<TextRead> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.type === 'text')!;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await read(layer.id);
    let opaque = 0;
    let glyph: [number, number] | null = null;
    for (let i = 0; i < r.width * r.height; i++) {
      if ((r.pixels[i * 4 + 3] ?? 0) > 230) {
        opaque++;
        glyph ??= [layer.x + (i % r.width), layer.y + Math.floor(i / r.width)];
      }
    }
    return { id: layer.id, x: layer.x, y: layer.y, width: r.width, height: r.height, glyph, opaque };
  });
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

test('a live text layer comes back after a context loss (#1088)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'text tool options bar requires desktop viewport');
  test.setTimeout(180_000);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, false);

  await page.keyboard.press('t');
  await setToolOption(page, 'Size', 60);
  const at = await docToScreen(page, 150, 250);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(100);
  await page.keyboard.type('HELLO');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);

  const before = await readText(page);
  expect(before.width).toBeGreaterThan(50);
  expect(before.glyph).not.toBeNull();
  const [gx, gy] = before.glyph!;
  expect((await compositeAt(page, gx, gy))[0]).toBeLessThan(80);

  // The user switches to another window: the backup is taken on `blur`.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  // The backup is read in idle slices after the blur (#1221): let it finish.
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as unknown as { __layerBackupStats: () => { committed: number; isPassPending: boolean } })
      .__layerBackupStats();
    return stats.committed > 0 && !stats.isPassPending;
  }), { timeout: 10_000 }).toBe(true);

  await loseAndRestoreContext(page);
  await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText('Layers were recovered from the backup');

  const after = await readText(page);
  // Pre-fix the texture came back 1×1 and the canvas showed only white.
  expect(after).toEqual(before);
  expect((await compositeAt(page, gx, gy))[0]).toBeLessThan(80);
});
