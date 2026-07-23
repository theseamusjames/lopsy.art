import { test, expect, type Page } from './fixtures';
import { createDocument, getEditorState, waitForStore } from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';

/** Height in px of the opaque region of a layer's GPU texture. */
async function opaqueHeight(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      layerId?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(id);
    if (!width || !height) return 0;
    let minRow = height;
    let maxRow = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 20) {
          if (y < minRow) minRow = y;
          if (y > maxRow) maxRow = y;
          break;
        }
      }
    }
    return maxRow < 0 ? 0 : maxRow - minRow + 1;
  }, layerId);
}

async function openTextPanel(page: Page): Promise<void> {
  await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
  await expect(page.locator('[aria-label="Line height value"]')).toBeVisible();
}

async function setPanelSlider(page: Page, label: string, value: number): Promise<void> {
  const input = page.locator(`[aria-label="${label} value"]`).first();
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(150);
}

test.describe('Text panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
  });

  test('increasing line height grows the committed text height', async ({ page }) => {
    await selectTextTool(page);
    await clickAtDoc(page, 150, 150);
    await page.keyboard.type('AB');
    await page.keyboard.press('Enter');
    await page.keyboard.type('CD');
    await page.keyboard.press('Shift+Enter'); // commit
    await page.waitForTimeout(200);

    const layer = (await getEditorState(page)).document.layers.find((l) => l.type === 'text');
    expect(layer).toBeDefined();
    const layerId = layer!.id;

    const before = await opaqueHeight(page, layerId);
    expect(before).toBeGreaterThan(0);

    await openTextPanel(page);
    await setPanelSlider(page, 'Line height', 3);

    const after = await opaqueHeight(page, layerId);
    // Two lines spread apart → the opaque region is clearly taller.
    expect(after).toBeGreaterThan(before * 1.2);
  });

  test('editing a committed layer keeps it anchored (no drift)', async ({ page }) => {
    await selectTextTool(page);
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Anchor');
    await page.keyboard.press('Shift+Enter'); // commit
    await page.waitForTimeout(200);

    const layerId = (await getEditorState(page)).document.layers.find((l) => l.type === 'text')!.id;
    const posOf = async () => {
      const l = (await getEditorState(page)).document.layers.find((x) => x.id === layerId)!;
      return { x: l.x, y: l.y };
    };
    const before = await posOf();

    await openTextPanel(page);

    // Toggling a decoration on then off returns to the original content, so the
    // anchored re-render must return the layer to its exact original position.
    // (Scope to the panel — the options bar has a like-named button too.)
    const underline = page.locator('[data-panel="text"] [aria-label="Toggle underline"]');
    await underline.click();
    await page.waitForTimeout(120);
    await underline.click();
    await page.waitForTimeout(120);

    const after = await posOf();
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });

  test('increasing letter spacing widens the committed text', async ({ page }) => {
    await selectTextTool(page);
    await clickAtDoc(page, 150, 150);
    await page.keyboard.type('AAAA');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);

    const layer = (await getEditorState(page)).document.layers.find((l) => l.type === 'text');
    const layerId = layer!.id;
    const widthOf = (id: string) =>
      page.evaluate(async (lid) => {
        const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
          layerId?: string,
        ) => Promise<{ width: number }>;
        return (await read(lid)).width;
      }, id);

    const before = await widthOf(layerId);
    await openTextPanel(page);
    await setPanelSlider(page, 'Letter spacing', 20);
    const after = await widthOf(layerId);
    expect(after).toBeGreaterThan(before + 20);
  });
});
