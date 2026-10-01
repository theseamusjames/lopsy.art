/**
 * #799 — the shared ColorPicker has a hex text field, so an exact colour can
 * be typed on every surface that uses the picker on its own: Gradient Editor
 * stops, Gradient Map stops, the Shape tool fill popover and the guide-colour
 * picker. The Color panel keeps its own single hex field.
 *
 * The field accepts 3 or 6 digits with or without '#', commits on Enter or
 * blur, reverts on invalid input and follows the colour while dragging.
 */
import { test, expect, type Page, type Locator } from './fixtures';
import { waitForStore, createDocument, getEditorState, selectTool } from './helpers';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

async function gradientToolStops(page: Page): Promise<Rgb[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { settings: { gradient: { stops: Array<{ position: number; color: Rgb }> } } };
    };
    return [...store.getState().settings.gradient.stops]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ r: s.color.r, g: s.color.g, b: s.color.b }));
  });
}

async function typeHex(field: Locator, text: string, commit: 'Enter' | 'Tab'): Promise<void> {
  await field.click();
  await field.fill(text);
  await field.press(commit);
}

test.describe('ColorPicker hex field (#799)', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'these pickers live in desktop options bars, drawers and dialogs');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('Gradient Editor: typed hex sets the selected stop; invalid input reverts', async ({ page }) => {
    await page.locator('[data-tool-id="gradient"]').click();
    await page.getByTestId('gradient-advanced-btn').click();
    const dialog = page.getByRole('dialog', { name: 'Gradient Editor' });
    await expect(dialog).toBeVisible();
    const hex = dialog.getByRole('textbox', { name: 'Hex color', exact: true });
    const sv = dialog.getByRole('slider', { name: 'Saturation and brightness' });

    // Stop 2 (white): six digits with '#', committed with Enter.
    await dialog.getByTestId('gradient-stop-1').click();
    await expect(hex).toHaveValue('FFFFFF');
    await typeHex(hex, '#3B1463', 'Enter');
    await expect(hex).toHaveValue('3B1463');
    expect(await gradientToolStops(page)).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 0x3b, g: 0x14, b: 0x63 },
    ]);
    // The SV cursor moves to the typed colour (hsv ≈ 270°, 80 %, 39 %).
    await expect(sv).toHaveAttribute('aria-valuetext', 'Saturation 80%, Brightness 39%');
    await page.screenshot({ path: 'e2e/screenshots/color-picker-hex-799-gradient-editor.png' });

    // Stop 1 (black): three-digit shorthand without '#', committed on blur.
    await dialog.getByTestId('gradient-stop-0').click();
    await expect(hex).toHaveValue('000000');
    await typeHex(hex, 'f80', 'Tab');
    await expect(hex).toHaveValue('FF8800');
    expect((await gradientToolStops(page))[0]).toEqual({ r: 255, g: 0x88, b: 0 });

    // Invalid input changes nothing and the field shows the stop's colour again.
    await typeHex(hex, '12345g', 'Enter');
    await expect(hex).toHaveValue('FF8800');
    expect((await gradientToolStops(page))[0]).toEqual({ r: 255, g: 0x88, b: 0 });

    // Dragging in the SV square keeps the field in sync with the stop: a drag
    // to the bottom-left corner lands on (near) black.
    const box = await sv.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 1, box!.y + box!.height - 1, { steps: 5 });
    await page.mouse.up();
    await expect(hex).toHaveValue(/^0[0-3]0[0-3]0[0-3]$/);
    const dragged = (await gradientToolStops(page))[0]!;
    const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
    await expect(hex).toHaveValue(`${toHex(dragged.r)}${toHex(dragged.g)}${toHex(dragged.b)}`);
  });

  test('Gradient Editor: Escape in the hex field discards the edit without closing the dialog', async ({ page }) => {
    await page.locator('[data-tool-id="gradient"]').click();
    await page.getByTestId('gradient-advanced-btn').click();
    const dialog = page.getByRole('dialog', { name: 'Gradient Editor' });
    await expect(dialog).toBeVisible();
    const hex = dialog.getByRole('textbox', { name: 'Hex color', exact: true });

    await dialog.getByTestId('gradient-stop-1').click();
    await hex.click();
    await hex.fill('ABCDEF');
    await hex.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(hex).toHaveValue('FFFFFF');
    await expect(hex).toBeFocused();
    expect((await gradientToolStops(page))[1]).toEqual({ r: 255, g: 255, b: 255 });

    // With focus elsewhere in the dialog (a stop handle), Escape still closes it.
    await dialog.getByTestId('gradient-stop-0').click();
    await expect(dialog.getByTestId('gradient-stop-0')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await gradientToolStops(page)).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    ]);
  });

  test('Gradient Map: typed hex recolours the selected stop', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = (await getEditorState(page)).document.activeLayerId!;
    await page.locator(`[data-layer-id="${groupId}"]`).locator('button[aria-label*="effects"]').click();
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer).toBeVisible();
    await page.locator('[aria-label="Add Adjustment"]').click();
    const item = page.getByRole('menuitem', { name: 'Gradient Map', exact: true });
    await item.waitFor({ state: 'visible', timeout: 3000 });
    await item.click();

    const hex = drawer.getByRole('textbox', { name: 'Hex color', exact: true });
    await hex.scrollIntoViewIfNeeded();
    await drawer.getByTestId('gradient-stop-0').click();
    await typeHex(hex, '15130F', 'Enter');
    await drawer.getByTestId('gradient-stop-1').click();
    await expect(hex).toHaveValue('FFFFFF');
    await typeHex(hex, '#EAE3D1', 'Enter');
    await page.screenshot({ path: 'e2e/screenshots/color-picker-hex-799-gradient-map.png' });

    // Each stop's handle swatch shows its typed colour.
    await expect(drawer.getByTestId('gradient-stop-0')).toHaveAttribute('style', /rgb\(21,\s*19,\s*15\)/);
    await expect(drawer.getByTestId('gradient-stop-1')).toHaveAttribute('style', /rgb\(234,\s*227,\s*209\)/);
    await drawer.getByTestId('gradient-stop-0').click();
    await expect(hex).toHaveValue('15130F');
  });

  test('Shape tool fill popover: typed hex sets the fill colour', async ({ page }) => {
    await selectTool(page, 'shape');
    const toolbar = page.getByRole('toolbar');
    const addFill = toolbar.getByRole('button', { name: 'Add fill color' });
    if (await addFill.isVisible()) {
      await addFill.click();
    } else {
      await toolbar.locator('[class*="swatchGroup"]').first().getByRole('button').first().click();
    }
    const popover = page.locator('[class*="colorPopover"]');
    await expect(popover).toBeVisible();
    const hex = popover.getByRole('textbox', { name: 'Hex color', exact: true });
    await typeHex(hex, '2a9d8f', 'Enter');
    await expect(hex).toHaveValue('2A9D8F');
    // Typing in the field must not have been eaten by tool shortcuts or closed the popover.
    await expect(popover).toBeVisible();
    const fill = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { settings: { shape: { fillColor: Rgb | null } } };
      };
      return store.getState().settings.shape.fillColor;
    });
    expect(fill).toMatchObject({ r: 0x2a, g: 0x9d, b: 0x8f });
    expect(await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { activeTool: string };
      };
      return store.getState().activeTool;
    })).toBe('shape');
  });

  test('guide-colour picker: typed hex sets the guide colour', async ({ page }) => {
    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    // Add a guide from the top ruler, then open the picker from the ruler corner.
    await page.mouse.click(box!.x + 100, box!.y + 10);
    await page.mouse.click(box!.x + 10, box!.y + 10);
    const picker = page.locator('[class*="guideColorPicker"]');
    await expect(picker).toBeVisible();

    const hex = picker.getByRole('textbox', { name: 'Hex color', exact: true });
    await typeHex(hex, '#FF00AA', 'Enter');
    await expect(picker).toBeVisible();
    await expect(hex).toHaveValue('FF00AA');
    const guideColor = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { guideColor: Rgb };
      };
      return store.getState().guideColor;
    });
    expect(guideColor).toMatchObject({ r: 255, g: 0, b: 0xaa });

    // Escape mid-edit discards the edit; the picker (closed by a document-level
    // Escape listener) stays open.
    await hex.fill('123456');
    await hex.press('Escape');
    await expect(picker).toBeVisible();
    await expect(hex).toHaveValue('FF00AA');

    // With the field unfocused, Escape closes the picker as before.
    await picker.getByRole('slider', { name: 'Hue' }).focus();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    const afterClose = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { guideColor: Rgb };
      };
      return store.getState().guideColor;
    });
    expect(afterClose).toMatchObject({ r: 255, g: 0, b: 0xaa });
  });

  test('Color panel keeps a single hex field', async ({ page }) => {
    const colorField = page.locator('[aria-label="Hex color value"]');
    await expect(colorField).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Hex color', exact: true })).toHaveCount(0);
  });
});
