import { test, expect, type Page } from './fixtures';
import { createDocument, getEditorState, setToolOption, waitForStore } from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';

/** Height of the opaque ink in a layer's GPU texture. */
async function inkHeight(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      layerId?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(id);
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 128) {
          if (top < 0) top = y;
          bottom = y;
          break;
        }
      }
    }
    return top < 0 ? 0 : bottom - top + 1;
  }, layerId);
}

const optionsBarSize = (page: Page) => page.locator('role=toolbar >> [aria-label="Size value"]').first();
const optionsBarKnob = (page: Page) => page.locator('role=toolbar >> input[type="range"][aria-label="Size"]').first();
const panelSize = (page: Page) => page.locator('[data-panel="text"] [aria-label="Size value"]');
const panelKnob = (page: Page) => page.locator('[data-panel="text"] input[type="range"][aria-label="Size"]');

async function openTextPanel(page: Page): Promise<void> {
  await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
  await expect(panelSize(page)).toBeVisible();
}

async function typeInto(page: Page, input: ReturnType<Page['locator']>, value: number): Promise<void> {
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(150);
}

test.describe('Text size above the slider range', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    // Long side 1400 → typed sizes may reach 1.5 × 1400 = 2100 px.
    await createDocument(page, 1400, 1000);
    await selectTextTool(page);
  });

  test('a typed 900 px size renders a 900 px glyph; the knob still ends at 500', async ({ page }) => {
    await setToolOption(page, 'Size', 900);
    await expect(optionsBarSize(page)).toHaveValue('900');
    await expect(optionsBarKnob(page)).toHaveAttribute('max', '500');

    await clickAtDoc(page, 200, 100);
    await page.keyboard.type('H');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/text-size-900.png' });

    const layer = (await getEditorState(page)).document.layers.find((l) => l.type === 'text') as
      { id: string; fontSize?: number } | undefined;
    expect(layer?.fontSize).toBe(900);
    // Inter's cap height is 0.727 em, so a 900 px "H" stands ~654 px tall
    // (a 500 px one would be ~364 px).
    const height = await inkHeight(page, layer!.id);
    expect(Math.abs(height - 654)).toBeLessThanOrEqual(8);
  });

  test('typed sizes stop at 1.5 × the document long side', async ({ page }) => {
    await setToolOption(page, 'Size', 99999);
    await expect(optionsBarSize(page)).toHaveValue('2100');
  });

  test('the Text panel field takes the same range and agrees with the options bar', async ({ page }) => {
    await clickAtDoc(page, 200, 100);
    await page.keyboard.type('H');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);
    const layerId = (await getEditorState(page)).document.layers.find((l) => l.type === 'text')!.id;
    const small = await inkHeight(page, layerId);

    await openTextPanel(page);
    await expect(panelKnob(page)).toHaveAttribute('max', '500');
    await typeInto(page, panelSize(page), 1200);
    await expect(panelSize(page)).toHaveValue('1200');
    await expect(optionsBarSize(page)).toHaveValue('1200');

    // The committed layer was re-rendered at the new size.
    const big = await inkHeight(page, layerId);
    expect(big).toBeGreaterThan(small * 10);
    expect(Math.abs(big - 0.727 * 1200)).toBeLessThanOrEqual(10);

    await typeInto(page, panelSize(page), 99999);
    await expect(panelSize(page)).toHaveValue('2100');
    await expect(optionsBarSize(page)).toHaveValue('2100');
  });
});
