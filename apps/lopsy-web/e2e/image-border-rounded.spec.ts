import { test, expect, type Page, type Locator } from '@playwright/test';
import { waitForStore, createDocument, getEditorState, getPixelAt, getRootGroupId } from './helpers';

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

async function applyBorder(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
}

async function borderLayerId(page: Page): Promise<string> {
  const state = await getEditorState(page);
  const layer = state.document.layers.find((l) => l.name === 'Border');
  expect(layer, 'a Border layer was added').toBeTruthy();
  return layer!.id;
}

const RED = { r: 255, g: 0, b: 0, a: 255 };

test.describe('Image → Border: rounded corners', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar requires desktop layout');
    await page.goto('/');
    await waitForStore(page);
    // Opaque 200x150 doc: a white "Background" with "Layer 1" active above it.
    await createDocument(page, 200, 150, false);
  });

  test('Overlay rounds the outer corners and the window corners', async ({ page }) => {
    const dialog = await openBorderDialog(page);
    await setBorderColor(dialog, 'ff0000');
    await dialog.getByLabel('Symmetric', { exact: true }).check();
    await dialog.getByLabel('Border width (px)').fill('30');
    await dialog.getByLabel('Overlay').check();
    await expect(dialog.getByLabel('Outer radius (px)')).toBeHidden();
    await dialog.getByLabel('Rounded corners').check();
    await dialog.getByLabel('Outer radius (px)').fill('25');
    await dialog.getByLabel('Inner radius (px)').fill('20');
    await applyBorder(dialog);

    const borderId = await borderLayerId(page);
    await page.screenshot({ path: 'e2e/screenshots/image-border-rounded-overlay.png' });

    // Outer corner: the canvas corner (0, 0) lies ~35 px from the centre
    // (25, 25) of the 25 px corner arc, so it is cut away.
    expect((await getPixelAt(page, 0, 0, borderId)).a, 'outer corner is transparent').toBe(0);
    expect((await getPixelAt(page, 199, 149, borderId)).a, 'opposite outer corner is transparent').toBe(0);
    // Straight edges of the frame, away from any corner, stay solid.
    expect(await getPixelAt(page, 100, 5, borderId), 'top edge').toMatchObject(RED);
    expect(await getPixelAt(page, 5, 75, borderId), 'left edge').toMatchObject(RED);
    // The window spans x 30..169, y 30..119. Its corner texel (31, 31) is
    // inside that rectangle but ~26 px from the centre (50, 50) of the 20 px
    // arc, so the frame fills it.
    expect(await getPixelAt(page, 31, 31, borderId), 'window top-left corner is filled').toMatchObject(RED);
    expect(await getPixelAt(page, 168, 118, borderId), 'window bottom-right corner is filled').toMatchObject(RED);
    // Along a straight window edge and in its centre the window stays open.
    expect((await getPixelAt(page, 100, 31, borderId)).a, 'window top edge is open').toBe(0);
    expect((await getPixelAt(page, 100, 75, borderId)).a, 'window centre is open').toBe(0);
  });

  test('Turning Rounded corners off keeps the square frame', async ({ page }) => {
    const dialog = await openBorderDialog(page);
    await setBorderColor(dialog, 'ff0000');
    await dialog.getByLabel('Symmetric', { exact: true }).check();
    await dialog.getByLabel('Border width (px)').fill('30');
    await dialog.getByLabel('Overlay').check();
    // Radii entered and then switched off must not reach the border.
    await dialog.getByLabel('Rounded corners').check();
    await dialog.getByLabel('Outer radius (px)').fill('25');
    await dialog.getByLabel('Inner radius (px)').fill('20');
    await dialog.getByLabel('Rounded corners').uncheck();
    await expect(dialog.getByLabel('Outer radius (px)')).toBeHidden();
    await applyBorder(dialog);

    const borderId = await borderLayerId(page);
    await page.screenshot({ path: 'e2e/screenshots/image-border-rounded-off.png' });

    expect(await getPixelAt(page, 0, 0, borderId), 'outer corner is solid').toMatchObject(RED);
    expect(await getPixelAt(page, 199, 149, borderId), 'opposite outer corner is solid').toMatchObject(RED);
    expect(await getPixelAt(page, 29, 29, borderId), 'last frame texel before the window').toMatchObject(RED);
    expect((await getPixelAt(page, 30, 30, borderId)).a, 'window corner is open').toBe(0);
    expect((await getPixelAt(page, 169, 119, borderId)).a, 'opposite window corner is open').toBe(0);
    expect((await getPixelAt(page, 100, 75, borderId)).a, 'window centre is open').toBe(0);
  });

  test('Expand with an inner radius covers the corners of the old canvas', async ({ page }) => {
    const rootId = await getRootGroupId(page);
    const dialog = await openBorderDialog(page);
    await setBorderColor(dialog, 'ff0000');
    await dialog.getByLabel('Symmetric', { exact: true }).check();
    await dialog.getByLabel('Border width (px)').fill('20');
    await dialog.getByLabel('Expand canvas').check();
    await dialog.getByLabel('Rounded corners').check();
    await dialog.getByLabel('Outer radius (px)').fill('30');
    await dialog.getByLabel('Inner radius (px)').fill('15');
    await applyBorder(dialog);

    const state = await getEditorState(page);
    expect(state.document.width).toBe(240);
    expect(state.document.height).toBe(190);
    const borderId = await borderLayerId(page);
    const order = state.document.layerOrder;
    expect(order[order.length - 1]).toBe(rootId);
    expect(order[order.length - 2], 'a windowed border sits above the content').toBe(borderId);

    await page.screenshot({ path: 'e2e/screenshots/image-border-rounded-expand.png' });

    expect((await getPixelAt(page, 0, 0, borderId)).a, 'outer corner is transparent').toBe(0);
    expect(await getPixelAt(page, 120, 10, borderId), 'top margin').toMatchObject(RED);
    // The old canvas now spans x 20..219, y 20..169; the frame fills its
    // corner texel (21, 21), ~19 px from the 15 px arc's centre (35, 35).
    expect(await getPixelAt(page, 21, 21, borderId), 'old canvas corner is covered').toMatchObject(RED);
    expect((await getPixelAt(page, 120, 95, borderId)).a, 'old canvas centre is open').toBe(0);
  });
});
