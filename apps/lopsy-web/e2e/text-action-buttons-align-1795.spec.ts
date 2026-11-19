import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, setToolOption, waitForStore } from './helpers';
import { clickAtDoc, getTextEditing, selectTextTool } from './text-edit-helpers';

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Screen rect of the ink in the layer being edited, from its live GPU texture. */
async function glyphBlockOnScreen(page: Page): Promise<ScreenRect> {
  const ink = await page.evaluate(async () => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { textEditing: { layerId: string } | null };
    };
    const ed = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const id = ui.getState().textEditing!.layerId;
    const layer = ed.getState().document.layers.find((l) => l.id === id)!;
    const { width, height, pixels } = await read(id);
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 32) {
          left = Math.min(left, x);
          right = Math.max(right, x + 1);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
    return { left: layer.x + left, right: layer.x + right, top: layer.y + top, bottom: layer.y + bottom };
  });
  expect(Number.isFinite(ink.left)).toBe(true);
  const tl = await docToScreen(page, ink.left, ink.top);
  const br = await docToScreen(page, ink.right, ink.bottom);
  return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
}

async function buttonRect(page: Page, label: string): Promise<ScreenRect> {
  const box = await page.locator(`button[aria-label="${label}"]`).boundingBox();
  expect(box).not.toBeNull();
  return { left: box!.x, top: box!.y, right: box!.x + box!.width, bottom: box!.y + box!.height };
}

const overlaps = (a: ScreenRect, b: ScreenRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function expectButtonsBesideGlyphs(page: Page, shot: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `e2e/screenshots/${shot}.png` });
  const glyphs = await glyphBlockOnScreen(page);
  for (const label of ['Commit text', 'Cancel text']) {
    const button = await buttonRect(page, label);
    expect(overlaps(button, glyphs), `${label} overlaps the glyphs`).toBe(false);
    // Docked to the left of the block, as for left-aligned text.
    expect(button.right).toBeLessThanOrEqual(glyphs.left);
    expect(glyphs.left - button.right).toBeLessThan(40);
  }
}

async function pickAlign(page: Page, align: 'left' | 'center' | 'right'): Promise<void> {
  await page.locator('select[aria-labelledby="text-align-label"]').selectOption(align);
  await page.waitForTimeout(150);
}

test.describe('Text Commit/Cancel buttons beside aligned point text (#1795)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await selectTextTool(page);
    await setToolOption(page, 'Size', 48);
  });

  test('right-aligned text keeps the buttons off its glyphs', async ({ page }) => {
    await pickAlign(page, 'right');
    await clickAtDoc(page, 650, 400);
    await page.keyboard.type('RIGHT ALIGN');
    expect(await getTextEditing(page)).not.toBeNull();
    await expectButtonsBesideGlyphs(page, 'text-buttons-1795-right');
  });

  test('center-aligned text keeps the buttons off its glyphs', async ({ page }) => {
    await pickAlign(page, 'center');
    await clickAtDoc(page, 400, 400);
    await page.keyboard.type('CENTER ALIGN');
    expect(await getTextEditing(page)).not.toBeNull();
    await expectButtonsBesideGlyphs(page, 'text-buttons-1795-center');
  });

  for (const [align, anchorX] of [['right', 700], ['center', 400]] as const) {
    test(`multi-line ${align}-aligned text docks beside its widest line`, async ({ page }) => {
      await pickAlign(page, align);
      await clickAtDoc(page, anchorX, 300);
      await page.keyboard.type('MID');
      await page.keyboard.press('Enter');
      await page.keyboard.type('A MUCH WIDER LINE');
      await expectButtonsBesideGlyphs(page, `text-buttons-1795-${align}-multiline`);
    });
  }

  test('left-aligned text still docks just left of the click point', async ({ page }) => {
    await clickAtDoc(page, 150, 400);
    await page.keyboard.type('LEFT ALIGN');
    await expectButtonsBesideGlyphs(page, 'text-buttons-1795-left');
    const click = await docToScreen(page, 150, 400);
    const commit = await buttonRect(page, 'Commit text');
    expect(Math.abs(commit.left - (click.x - 36))).toBeLessThanOrEqual(4);
  });
});
