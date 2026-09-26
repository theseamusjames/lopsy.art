// #904 — Image → Image Size resampled raster pixels and scaled layer x/y,
// but left text fontSize and layer-effect dimensions (drop shadow offset/blur,
// stroke width) at their old pixel values. This drives the real Image Size
// dialog on a document with a text layer carrying a drop shadow and a
// stroke, and asserts the resulting values scale with the document.

import { test, expect, type Page } from '@playwright/test';
import {
  createDocument,
  setForegroundColor,
  selectTool,
  setToolOption,
  docToScreen,
  waitForStore,
  getEditorState,
  configureEffect,
  closeEffectsPanel,
} from './helpers';

interface TextLayerSnapshot {
  type: string;
  fontSize: number;
  effects: {
    dropShadow: { offsetX: number; offsetY: number; blur: number };
    stroke: { width: number };
  };
}

async function openImageMenuItem(page: Page, itemLabel: string): Promise<void> {
  await page.locator('button:has-text("Image")').first().click();
  await page.locator(`[role="menuitem"]:has-text("${itemLabel}")`).click();
  await page.waitForTimeout(200);
}

// Reads the text-specific fields Image Size must scale directly off the
// store, since `getEditorState`'s snapshot type doesn't declare them.
async function getTextLayerSnapshot(page: Page, layerId: string): Promise<TextLayerSnapshot | null> {
  return page.evaluate((id) => {
    const store = (window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<TextLayerSnapshot & { id: string }> } } };
    }).__editorStore.getState();
    const layer = store.document.layers.find((l) => l.id === id);
    return layer ?? null;
  }, layerId);
}

// Type a text layer at a doc position and commit it via the move tool.
// Returns the committed layer's ID. Mirrors the pattern used by
// e2e/text-decorations.spec.ts.
async function typeAndCommitText(page: Page, text: string, docX: number, docY: number): Promise<string> {
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
  const layerId = await page.evaluate(() => {
    const store = (window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string }> } } };
    }).__editorStore.getState();
    const textLayers = store.document.layers.filter((l) => l.type === 'text');
    return textLayers.at(-1)?.id ?? null;
  });
  expect(layerId).not.toBeNull();
  return layerId!;
}

test.describe('#904 — Image Size scales text fontSize and layer-effect dimensions', () => {
  test('doubling the document doubles fontSize, drop shadow, and stroke dimensions', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar and text tool require desktop layout');
    await page.goto('/');
    await waitForStore(page);

    await createDocument(page, 400, 400, true);
    await setForegroundColor(page, 255, 255, 255);
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 50);

    const layerId = await typeAndCommitText(page, 'HELLO', 200, 200);

    // Configure a drop shadow and a stroke on the committed text layer
    // (it's still the active layer after typeAndCommitText).
    await configureEffect(page, 'Drop Shadow', { 'Offset X': 10, 'Offset Y': 12, 'Blur': 20 });
    await configureEffect(page, 'Stroke', { 'Width': 6 });
    await closeEffectsPanel(page);

    const beforeLayer = await getTextLayerSnapshot(page, layerId);
    expect(beforeLayer).not.toBeNull();
    expect(beforeLayer!.fontSize).toBe(50);
    expect(beforeLayer!.effects.dropShadow.offsetX).toBe(10);
    expect(beforeLayer!.effects.dropShadow.offsetY).toBe(12);
    expect(beforeLayer!.effects.dropShadow.blur).toBe(20);
    expect(beforeLayer!.effects.stroke.width).toBe(6);

    await page.screenshot({ path: 'e2e/screenshots/image-size-904-before.png' });

    // Uniform 2x resize via the real Image Size dialog.
    await openImageMenuItem(page, 'Image Size');
    const dialog = page.getByRole('dialog', { name: 'Image Size' });
    await expect(dialog).toBeVisible();
    const widthInput = dialog.locator('input[type="number"]').first();
    await widthInput.fill('800');
    // Constrain proportions is on by default, so height follows to 800.
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(200);

    const after = await getEditorState(page);
    expect(after.document.width).toBe(800);
    expect(after.document.height).toBe(800);

    const afterLayer = await getTextLayerSnapshot(page, layerId);
    expect(afterLayer).not.toBeNull();
    // Text layers stay `type: 'text'` after commit — see e2e/GUIDE.md pitfall #13.
    expect(afterLayer!.type).toBe('text');

    // A uniform 2x resize scales fontSize and every effect dimension by 2.
    expect(afterLayer!.fontSize).toBe(100);
    expect(afterLayer!.effects.dropShadow.offsetX).toBe(20);
    expect(afterLayer!.effects.dropShadow.offsetY).toBe(24);
    expect(afterLayer!.effects.dropShadow.blur).toBe(40);
    expect(afterLayer!.effects.stroke.width).toBe(12);

    await page.screenshot({ path: 'e2e/screenshots/image-size-904-after.png' });
  });
});
