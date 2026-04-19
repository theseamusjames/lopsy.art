import { test, expect, type Page } from './fixtures';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 600, height = 400) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, true);
    },
    { w: width, h: height },
  );
  await page.waitForTimeout(200);
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function countColorPixels(snap: PixelSnapshot, target: { r: number; g: number; b: number }, tolerance = 30): number {
  let count = 0;
  for (let i = 0; i < snap.pixels.length; i += 4) {
    const dr = Math.abs((snap.pixels[i] ?? 0) - target.r);
    const dg = Math.abs((snap.pixels[i + 1] ?? 0) - target.g);
    const db = Math.abs((snap.pixels[i + 2] ?? 0) - target.b);
    const da = snap.pixels[i + 3] ?? 0;
    if (da > 50 && dr <= tolerance && dg <= tolerance && db <= tolerance) count++;
  }
  return count;
}

test.describe('Stroke effect on in-progress brush stroke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
  });

  test('new stroke gets stroke effect immediately after mouseup', async ({ page }) => {
    // Black brush
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setBrushSize: (v: number) => void;
          setBrushHardness: (v: number) => void;
          setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
        };
      };
      store.getState().setBrushSize(30);
      store.getState().setBrushHardness(100);
      store.getState().setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
    });

    // Stroke 1 on the left
    await drawStroke(page, { x: 120, y: 200 }, { x: 200, y: 200 });

    // Enable red stroke effect on the active layer
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string | null; layers: Array<{ id: string; effects: Record<string, unknown> }> };
          updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
        };
      };
      const { document: doc, updateLayerEffects } = store.getState();
      const id = doc.activeLayerId!;
      const layer = doc.layers.find((l) => l.id === id)!;
      updateLayerEffects(id, {
        ...layer.effects,
        stroke: { enabled: true, color: { r: 255, g: 0, b: 0, a: 1 }, width: 6, position: 'outside' },
      });
    });
    await page.waitForTimeout(200);

    // Stroke 2 on the right (far from stroke 1 so their effects don't overlap)
    await drawStroke(page, { x: 420, y: 200 }, { x: 500, y: 200 });

    await page.screenshot({ path: 'test-results/screenshots/stroke-effect-live.png' });

    const snap = await snapshot(page);
    expect(snap.width).toBeGreaterThan(0);

    // Count red outline pixels around the right half (x >= 300) vs left half (x < 300).
    // With the bug: red appears only around stroke 1 (left). With the fix: both strokes.
    let leftRed = 0;
    let rightRed = 0;
    for (let y = 0; y < snap.height; y++) {
      for (let x = 0; x < snap.width; x++) {
        const i = (y * snap.width + x) * 4;
        const r = snap.pixels[i] ?? 0;
        const g = snap.pixels[i + 1] ?? 0;
        const b = snap.pixels[i + 2] ?? 0;
        const a = snap.pixels[i + 3] ?? 0;
        if (a > 50 && r > 180 && g < 80 && b < 80) {
          if (x < snap.width / 2) leftRed++;
          else rightRed++;
        }
      }
    }

    // Debug output in the test log
    console.log(`Red outline pixels — left: ${leftRed}, right: ${rightRed}`);

    expect(leftRed).toBeGreaterThan(20);
    expect(rightRed).toBeGreaterThan(20);
  });
});
