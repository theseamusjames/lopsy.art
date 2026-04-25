import { test, expect, type Page } from './fixtures';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
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

async function drawStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 15,
) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function setUIState(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const colorSetters = new Set(['setForegroundColor', 'setBackgroundColor', 'swapColors', 'resetColors', 'addRecentColor']);
    const storeKey = colorSetters.has(setter) ? '__toolSettingsStore' : '__uiStore';
    const store = (window as unknown as Record<string, unknown>)[storeKey] as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function pixelDiff(a: PixelSnapshot, b: PixelSnapshot): number {
  let count = 0;
  const len = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0));
    const dg = Math.abs((a.pixels[i + 1] ?? 0) - (b.pixels[i + 1] ?? 0));
    const db = Math.abs((a.pixels[i + 2] ?? 0) - (b.pixels[i + 2] ?? 0));
    if (dr + dg + db > 30) count++;
  }
  return count;
}

async function getActiveTool(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

test.describe('Smudge Tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('draws a full image then smudges a red/blue boundary via real UI', async ({ page }) => {
    test.setTimeout(180_000);

    // Step 1: Paint the full image with the brush via the real UI.
    // Select brush via keyboard shortcut.
    await page.keyboard.press('b');
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('brush');

    await setToolSetting(page, 'setBrushSize', 100);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 25);

    const baseline = await snapshot(page);

    // Paint the left half red — overlapping rows completely cover the canvas.
    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });
    for (let y = 50; y < 400; y += 70) {
      await drawStroke(page, { x: 0, y }, { x: 300, y }, 6);
    }
    // Paint the right half blue.
    await setUIState(page, 'setForegroundColor', { r: 0, g: 0, b: 255, a: 1 });
    for (let y = 50; y < 400; y += 70) {
      await drawStroke(page, { x: 300, y }, { x: 600, y }, 6);
    }

    const painted = await snapshot(page);
    // A non-trivial portion of the full image should be painted.
    expect(pixelDiff(baseline, painted)).toBeGreaterThan(10000);
    await page.screenshot({ path: 'e2e/screenshots/smudge-01-painted-image.png' });

    // Step 2: Switch to smudge via keyboard shortcut 'r' and verify it activated.
    await page.keyboard.press('r');
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('smudge');

    await setToolSetting(page, 'setSmudgeSize', 80);
    await setToolSetting(page, 'setSmudgeStrength', 90);

    // Step 3: Drag horizontally from the red side into the blue side at
    // a few heights to smudge the boundary.
    for (let y = 80; y < 360; y += 80) {
      await drawStroke(page, { x: 200, y }, { x: 400, y }, 15);
    }

    const smudged = await snapshot(page);
    await page.screenshot({ path: 'e2e/screenshots/smudge-02-smudged.png' });

    // Step 4: Verify that the smudge actually modified pixels.
    const changed = pixelDiff(painted, smudged);
    expect(changed).toBeGreaterThan(1000);

    // Step 5: Verify that the smudge created intermediate (purple-ish)
    // pixels near the boundary — pixels whose red AND blue channels are
    // both substantial (indicating the red pulled into blue and vice versa).
    let purpleCount = 0;
    const len = smudged.pixels.length;
    for (let i = 0; i < len; i += 4) {
      const r = smudged.pixels[i] ?? 0;
      const g = smudged.pixels[i + 1] ?? 0;
      const b = smudged.pixels[i + 2] ?? 0;
      if (r > 40 && b > 40 && g < 60) purpleCount++;
    }
    expect(purpleCount).toBeGreaterThan(500);
  });

  test('smudge tool is registered in toolbox UI', async ({ page }) => {
    // The toolbox renders the smudge tool with a Droplets icon and label
    // "Smudge (R)". Clicking the label-tagged button activates the tool.
    const smudgeButton = page.locator('[aria-label^="Smudge"]').first();
    await expect(smudgeButton).toBeVisible();
    await smudgeButton.click();
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('smudge');
  });
});
