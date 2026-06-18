// E2E tests for underline and strikethrough text decorations.
//
// Strategy: create a text layer (white text on transparent), enable a decoration
// via the options bar toggle, commit via move tool, then compare opaque pixel counts
// between the plain and decorated renders. A decoration adds a horizontal bar of
// pixels, so the opaque count with decoration must exceed the plain count.
//
// Screenshots are taken at each key step so reviewers can verify the visual output.

import { test, expect } from '@playwright/test';
import {
  createDocument,
  setForegroundColor,
  selectTool,
  docToScreen,
  waitForStore,
} from './helpers';

// Count opaque pixels in a layer's GPU texture.
async function countOpaquePixels(page: import('@playwright/test').Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const readFn = (window as unknown as {
      __readLayerPixels: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    }).__readLayerPixels;
    const r = await readFn(id);
    if (!r || r.width === 0) return 0;
    let count = 0;
    for (let i = 3; i < r.pixels.length; i += 4) {
      if ((r.pixels[i] ?? 0) > 0) count++;
    }
    return count;
  }, layerId);
}

// Click the underline toggle button in the options bar.
async function clickUnderlineToggle(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[aria-label="Toggle underline"]').click();
}

// Click the strikethrough toggle button in the options bar.
async function clickStrikethroughToggle(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[aria-label="Toggle strikethrough"]').click();
}

// Type a text layer at a doc position and commit it via the move tool.
// Returns the committed layer's ID.
async function typeAndCommitText(
  page: import('@playwright/test').Page,
  text: string,
  docX: number,
  docY: number,
): Promise<string> {
  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);
  await selectTool(page, 'text');
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(200);
  await page.keyboard.type(text);
  await page.waitForTimeout(200);
  // Commit by switching to the move tool (keyboard 't' would feed into the text editor).
  await page.locator('[data-tool-id="move"]').click();
  await page.waitForTimeout(300);
  // Find the text layer — it's the most recently added layer.
  const layerId = await page.evaluate(() => {
    const store = (window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string; name: string }> } } };
    }).__editorStore.getState();
    const textLayers = store.document.layers.filter((l) => l.type === 'text');
    return textLayers.at(-1)?.id ?? null;
  });
  expect(layerId).not.toBeNull();
  return layerId!;
}

// ---------------------------------------------------------------------------

test.describe('text decorations', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, true);
    await setForegroundColor(page, 255, 255, 255);
    await selectTool(page, 'text');
    // Ensure decorations start off.
    const underlineBtn = page.locator('[aria-label="Toggle underline"]');
    if (await underlineBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const pressed = await underlineBtn.getAttribute('aria-pressed');
      if (pressed === 'true') await underlineBtn.click();
    }
    const strikethroughBtn = page.locator('[aria-label="Toggle strikethrough"]');
    if (await strikethroughBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const pressed = await strikethroughBtn.getAttribute('aria-pressed');
      if (pressed === 'true') await strikethroughBtn.click();
    }
  });

  test('underline toggle is visible in the text options bar', async ({ page }) => {
    await selectTool(page, 'text');
    const btn = page.locator('[aria-label="Toggle underline"]');
    await expect(btn).toBeVisible();
    expect(await btn.getAttribute('aria-pressed')).toBe('false');

    await btn.click();
    expect(await btn.getAttribute('aria-pressed')).toBe('true');

    await page.screenshot({ path: 'e2e/screenshots/text-decorations-underline-toggle.png' });
  });

  test('strikethrough toggle is visible in the text options bar', async ({ page }) => {
    await selectTool(page, 'text');
    const btn = page.locator('[aria-label="Toggle strikethrough"]');
    await expect(btn).toBeVisible();
    expect(await btn.getAttribute('aria-pressed')).toBe('false');

    await btn.click();
    expect(await btn.getAttribute('aria-pressed')).toBe('true');

    await page.screenshot({ path: 'e2e/screenshots/text-decorations-strikethrough-toggle.png' });
  });

  test('underline adds pixels below text baseline', async ({ page }) => {
    // Create plain text layer.
    const plainId = await typeAndCommitText(page, 'HELLO', 300, 200);
    const plainOpaque = await countOpaquePixels(page, plainId);
    expect(plainOpaque).toBeGreaterThan(10); // basic sanity: text was rasterized.

    await page.screenshot({ path: 'e2e/screenshots/text-decorations-plain-text.png' });

    // Enable underline and create another text layer with the same content.
    await selectTool(page, 'text');
    await clickUnderlineToggle(page);
    const underlineId = await typeAndCommitText(page, 'HELLO', 300, 310);
    const underlineOpaque = await countOpaquePixels(page, underlineId);

    await page.screenshot({ path: 'e2e/screenshots/text-decorations-underline-text.png' });

    // The underline adds a filled horizontal bar, so opaque pixel count must be higher.
    expect(underlineOpaque).toBeGreaterThan(plainOpaque);

    // Verify the layer type is still 'text' (not rasterized to raster type).
    const layerType = await page.evaluate((id) => {
      const store = (window as unknown as {
        __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string }> } } };
      }).__editorStore.getState();
      return store.document.layers.find((l) => l.id === id)?.type ?? null;
    }, underlineId);
    expect(layerType).toBe('text');
  });

  test('strikethrough adds pixels through text mid-line', async ({ page }) => {
    // Create plain text layer.
    const plainId = await typeAndCommitText(page, 'HELLO', 300, 200);
    const plainOpaque = await countOpaquePixels(page, plainId);
    expect(plainOpaque).toBeGreaterThan(10);

    // Enable strikethrough and create another text layer with the same content.
    await selectTool(page, 'text');
    await clickStrikethroughToggle(page);
    const strikeId = await typeAndCommitText(page, 'HELLO', 300, 310);
    const strikeOpaque = await countOpaquePixels(page, strikeId);

    await page.screenshot({ path: 'e2e/screenshots/text-decorations-strikethrough-text.png' });

    // Strikethrough adds a horizontal bar through the glyphs, so the opaque pixel
    // count must be higher than plain text.
    expect(strikeOpaque).toBeGreaterThan(plainOpaque);

    const layerType = await page.evaluate((id) => {
      const store = (window as unknown as {
        __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string }> } } };
      }).__editorStore.getState();
      return store.document.layers.find((l) => l.id === id)?.type ?? null;
    }, strikeId);
    expect(layerType).toBe('text');
  });

  test('re-editing a text layer restores its decoration state to the options bar', async ({ page }) => {
    // Enable underline, type text, commit.
    await selectTool(page, 'text');
    await clickUnderlineToggle(page);
    const layerId = await typeAndCommitText(page, 'RE-EDIT', 300, 200);

    // Verify committed layer has underline=true in the store.
    const storedUnderline = await page.evaluate((id) => {
      const store = (window as unknown as {
        __editorStore: { getState: () => { document: { layers: Array<{ id: string; underline: boolean }> } } };
      }).__editorStore.getState();
      return store.document.layers.find((l) => l.id === id)?.underline ?? null;
    }, layerId);
    expect(storedUnderline).toBe(true);

    // Re-edit: click on the text layer with the text tool.
    await selectTool(page, 'text');
    const pos = await docToScreen(page, 300, 200);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(300);

    // The underline button should now reflect the layer's stored state.
    const underlineBtn = page.locator('[aria-label="Toggle underline"]');
    expect(await underlineBtn.getAttribute('aria-pressed')).toBe('true');

    await page.screenshot({ path: 'e2e/screenshots/text-decorations-re-edit-restores-state.png' });
  });
});
