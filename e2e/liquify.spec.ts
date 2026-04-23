import { test, expect, type Page } from './fixtures';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 200, height = 200, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
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
    const colorSetters = new Set(['setForegroundColor', 'setBackgroundColor']);
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

test.describe('Liquify Tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('push mode warps a red/blue boundary', async ({ page }) => {
    test.setTimeout(120_000);

    // Paint a red left half and blue right half
    await page.keyboard.press('b');
    await page.waitForTimeout(100);
    await setToolSetting(page, 'setBrushSize', 80);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 25);

    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });
    for (let y = 30; y < 200; y += 50) {
      await drawStroke(page, { x: 0, y }, { x: 100, y }, 4);
    }
    await setUIState(page, 'setForegroundColor', { r: 0, g: 0, b: 255, a: 1 });
    for (let y = 30; y < 200; y += 50) {
      await drawStroke(page, { x: 100, y }, { x: 200, y }, 4);
    }

    await page.screenshot({ path: 'e2e/screenshots/liquify-before.png' });
    const before = await snapshot(page);

    // Switch to liquify, push mode
    await setUIState(page, 'setActiveTool', 'liquify');
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('liquify');

    await setToolSetting(page, 'setLiquifySize', 80);
    await setToolSetting(page, 'setLiquifyStrength', 80);
    await setToolSetting(page, 'setLiquifyMode', 'push');

    // Push from red into blue side
    for (let y = 50; y < 180; y += 40) {
      await drawStroke(page, { x: 60, y }, { x: 140, y }, 15);
    }

    await page.screenshot({ path: 'e2e/screenshots/liquify-after-push.png' });
    const after = await snapshot(page);

    const changed = pixelDiff(before, after);
    expect(changed).toBeGreaterThan(500);

    // Verify warping created blended pixels near the boundary:
    // red pixels should have been pushed into the blue zone
    let redInBlueZone = 0;
    const w = after.width;
    for (let y = 20; y < after.height - 20; y++) {
      for (let x = w * 0.55; x < w * 0.75; x++) {
        const i = (y * w + Math.floor(x)) * 4;
        const r = after.pixels[i] ?? 0;
        const b = after.pixels[i + 2] ?? 0;
        if (r > 80 && r > b) redInBlueZone++;
      }
    }
    expect(redInBlueZone).toBeGreaterThan(100);
  });

  test('twirl mode creates rotational distortion', async ({ page }) => {
    test.setTimeout(120_000);

    // Paint a simple pattern: red top half, green bottom half
    await page.keyboard.press('b');
    await page.waitForTimeout(100);
    await setToolSetting(page, 'setBrushSize', 100);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 25);

    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });
    for (let y = 20; y < 100; y += 50) {
      await drawStroke(page, { x: 0, y }, { x: 200, y }, 4);
    }
    await setUIState(page, 'setForegroundColor', { r: 0, g: 255, b: 0, a: 1 });
    for (let y = 100; y < 200; y += 50) {
      await drawStroke(page, { x: 0, y }, { x: 200, y }, 4);
    }

    await page.screenshot({ path: 'e2e/screenshots/liquify-twirl-before.png' });
    const before = await snapshot(page);

    // Switch to liquify, twirl mode
    await setUIState(page, 'setActiveTool', 'liquify');
    await page.waitForTimeout(100);

    await setToolSetting(page, 'setLiquifySize', 120);
    await setToolSetting(page, 'setLiquifyStrength', 90);
    await setToolSetting(page, 'setLiquifyMode', 'twirl');

    // Twirl at center of the canvas
    const center = await docToScreen(page, 100, 100);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    // Small circular motion to apply multiple dabs at/near center
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const ox = Math.cos(angle) * 5;
      const oy = Math.sin(angle) * 5;
      await page.mouse.move(center.x + ox, center.y + oy);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/liquify-twirl-after.png' });
    const after = await snapshot(page);

    const changed = pixelDiff(before, after);
    expect(changed).toBeGreaterThan(300);
  });

  test('liquify tool appears in toolbox UI', async ({ page }) => {
    const liquifyButton = page.locator('[aria-label^="Liquify"]').first();
    await expect(liquifyButton).toBeVisible();
    await liquifyButton.click();
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('liquify');

    // Verify options bar shows mode selector and sliders
    await page.screenshot({ path: 'e2e/screenshots/liquify-ui.png' });
    const modeSelect = page.locator('select[aria-labelledby="liquify-mode-label"]');
    await expect(modeSelect).toBeVisible();
    const modeValue = await modeSelect.inputValue();
    expect(modeValue).toBe('push');
  });
});
