import { test, expect, type Page, type Locator } from '@playwright/test';
import { waitForStore, createDocument, getEditorState, getPixelAt, drawRect, getRootGroupId, undo } from './helpers';

async function openBorderDialog(page: Page): Promise<Locator> {
  await page.locator('button:has-text("Image")').first().click();
  await page.getByRole('menuitem', { name: 'Border...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Border' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setBorderColor(dialog: Locator, hex: string): Promise<void> {
  const input = dialog.getByLabel('Hex color', { exact: true });
  await input.fill(hex);
  await input.press('Enter');
}

function borderLayerId(state: Awaited<ReturnType<typeof getEditorState>>): string {
  const layer = state.document.layers.find((l) => l.name === 'Border');
  expect(layer, 'a Border layer was added').toBeTruthy();
  return layer!.id;
}

test.describe('Image → Border', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar requires desktop layout');
    await page.goto('/');
    await waitForStore(page);
    // Opaque 200x150 doc: a white "Background" with "Layer 1" active above it.
    await createDocument(page, 200, 150, false);
  });

  test('Expand canvas grows the document and puts a solid border layer underneath', async ({ page }) => {
    const before = await getEditorState(page);
    const layer1 = before.document.layers.find((l) => l.name === 'Layer 1')!;
    // A red marker in the top-left corner shows where the content lands.
    await drawRect(page, 0, 0, 40, 40, { r: 255, g: 0, b: 0 });

    const dialog = await openBorderDialog(page);
    await setBorderColor(dialog, '0000ff');
    await dialog.getByLabel('Symmetric', { exact: true }).check();
    await dialog.getByLabel('Border width (px)').fill('20');
    await dialog.getByLabel('Expand canvas').check();
    await expect(dialog.getByText('New size: 240 × 190 px')).toBeVisible();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();

    const after = await getEditorState(page);
    expect(after.document.width).toBe(240);
    expect(after.document.height).toBe(190);
    const borderId = borderLayerId(after);
    expect(after.document.layerOrder[0], 'border is the bottom layer').toBe(borderId);

    await page.screenshot({ path: 'e2e/screenshots/image-border-expand.png' });

    // The border layer is solid blue edge to edge.
    for (const [x, y] of [[0, 0], [239, 189], [10, 95], [120, 95]] as const) {
      const p = await getPixelAt(page, x, y, borderId);
      expect(p, `border layer at (${x}, ${y})`).toMatchObject({ r: 0, g: 0, b: 255, a: 255 });
    }
    // Content moved by the left/top width: the red marker now starts at (20, 20).
    const shifted = await getPixelAt(page, 25, 25, layer1.id);
    expect(shifted.r).toBeGreaterThan(200);
    expect(shifted.a).toBeGreaterThan(200);
    const vacated = await getPixelAt(page, 10, 10, layer1.id);
    expect(vacated.a, 'nothing of Layer 1 is left in the new margin').toBe(0);

    await undo(page);
    const undone = await getEditorState(page);
    expect(undone.document.width).toBe(200);
    expect(undone.document.height).toBe(150);
    expect(undone.document.layers.some((l) => l.name === 'Border')).toBe(false);
  });

  test('Overlay keeps the canvas size and cuts an asymmetric window in a top layer', async ({ page }) => {
    const rootId = await getRootGroupId(page);

    const dialog = await openBorderDialog(page);
    await setBorderColor(dialog, 'ff0000');
    await dialog.getByLabel('Asymmetric').check();
    await dialog.getByLabel('Top (px)').fill('10');
    await dialog.getByLabel('Bottom (px)').fill('20');
    await dialog.getByLabel('Left (px)').fill('30');
    await dialog.getByLabel('Right (px)').fill('40');
    await dialog.getByLabel('Overlay').check();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();

    const after = await getEditorState(page);
    expect(after.document.width).toBe(200);
    expect(after.document.height).toBe(150);
    const borderId = borderLayerId(after);
    const order = after.document.layerOrder;
    expect(order[order.length - 1]).toBe(rootId);
    expect(order[order.length - 2], 'border is the top layer inside the project group').toBe(borderId);

    await page.screenshot({ path: 'e2e/screenshots/image-border-overlay.png' });

    // Window spans x 30..159, y 10..129. Each probe pair straddles one edge.
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const probes: Array<[number, number, boolean]> = [
      [29, 75, true], [30, 75, false],
      [159, 75, false], [160, 75, true],
      [100, 9, true], [100, 10, false],
      [100, 129, false], [100, 130, true],
      [0, 0, true], [199, 149, true], [95, 70, false],
    ];
    for (const [x, y, isBorder] of probes) {
      const p = await getPixelAt(page, x, y, borderId);
      if (isBorder) {
        expect(p, `(${x}, ${y}) is border`).toMatchObject(red);
      } else {
        expect(p.a, `(${x}, ${y}) is inside the window`).toBe(0);
      }
    }
  });

  test('Apply is disabled until a border width is entered', async ({ page }) => {
    const dialog = await openBorderDialog(page);
    await dialog.getByLabel('Border width (px)').fill('0');
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await expect(dialog.getByText('Enter a border width.')).toBeVisible();
  });
});
