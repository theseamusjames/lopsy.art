/**
 * Characterization: the Help menu, item by item, as it behaves today.
 *
 * These specs pin which modal each item opens and how it closes, and what
 * Agents leaves behind in the editor tab, so the move onto the command
 * registry can be checked against them. agent-docs.spec.ts already pins the
 * new tab's path and body; this file does not repeat that.
 */
import { test, expect, type Page } from './fixtures';
import {
  clickMenu,
  fillRect,
  historyLabels,
  layerPixelHash,
  openDialogName,
  openDialogNames,
  openDocument,
  settle,
  surfaceState,
  toasts,
} from './surface-helpers';

const RED = { r: 255, g: 0, b: 0 };
const SHORTCUT_STORAGE_KEY = 'lopsy-shortcut-customizations';

async function documentId(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __editorStore: { getState: () => { document: { id: string } } } }).__editorStore.getState().document.id,
  );
}

async function storedShortcuts(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), SHORTCUT_STORAGE_KEY);
}

test.describe('Help menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  test('Keyboard Shortcuts opens the "Keyboard Shortcuts" modal listing the tool keys; Close closes it', async ({ page }) => {
    await clickMenu(page, 'Help', 'Keyboard Shortcuts');

    expect(await openDialogNames(page)).toEqual(['Keyboard Shortcuts']);
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Tool rows show their current key and are rebindable buttons.
    const tools: Array<[string, string]> = [
      ['Move', 'v'], ['Brush', 'b'], ['Pencil', 'n'], ['Eraser', 'e'], ['Fill', 'g'],
      ['Eyedropper', 'i'], ['Text', 't'], ['Shape', 'u'], ['Marquee', 'm'], ['Lasso', 'l'],
      ['Magic Wand', 'w'], ['Crop', 'c'], ['Path', 'p'], ['Stamp', 's'], ['Dodge', 'o'],
      ['Swap Colors', 'x'], ['Reset Colors', 'd'],
    ];
    for (const [label, key] of tools) {
      const button = dialog.getByRole('button', { name: `${label} shortcut: ${key}. Click to rebind.`, exact: true });
      await expect(button).toHaveText(key.toUpperCase());
    }
    // Modifier shortcuts are listed but not rebindable.
    await expect(dialog.getByText('⇧⌘Z', { exact: true })).toBeVisible();
    await expect(dialog.getByText('⌘0', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Reset .* to default$/ })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await settle(page);

    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
    expect(await storedShortcuts(page)).toBeNull();
  });

  test('Keyboard Shortcuts closes on a backdrop press but not on Escape', async ({ page }) => {
    await clickMenu(page, 'Help', 'Keyboard Shortcuts');
    expect(await openDialogName(page)).toBe('Keyboard Shortcuts');

    // Pinned as-is: the modal has no Escape handler, and aria-modal stops the
    // global one, so Escape leaves it open.
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await openDialogName(page)).toBe('Keyboard Shortcuts');

    await page.mouse.click(5, 700);
    await settle(page);
    expect(await openDialogName(page)).toBeNull();
  });

  test('Keyboard Shortcuts: a rebind persists and shows, and its reset button restores the default', async ({ page }) => {
    await clickMenu(page, 'Help', 'Keyboard Shortcuts');
    const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });

    await dialog.getByRole('button', { name: 'Brush shortcut: b. Click to rebind.', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Brush shortcut: listening — press a key or Escape', exact: true })).toHaveText('Press a key…');
    await page.keyboard.press('k');
    await settle(page);

    await expect(dialog.getByRole('button', { name: 'Brush shortcut: k. Click to rebind.', exact: true })).toHaveText('K');
    expect(JSON.parse((await storedShortcuts(page)) ?? '{}')).toMatchObject({ state: { customShortcuts: { brush: 'k' } } });

    await dialog.getByRole('button', { name: 'Reset Brush to default', exact: true }).click();
    await settle(page);

    await expect(dialog.getByRole('button', { name: 'Brush shortcut: b. Click to rebind.', exact: true })).toHaveText('B');
    await expect(dialog.getByRole('button', { name: 'Reset Brush to default' })).toHaveCount(0);
    expect(JSON.parse((await storedShortcuts(page)) ?? '{}')).toMatchObject({ state: { customShortcuts: {} } });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('About Lopsy opens the "About Lopsy" modal; Close closes it', async ({ page }) => {
    await clickMenu(page, 'Help', 'About Lopsy');

    expect(await openDialogNames(page)).toEqual(['About Lopsy']);
    const dialog = page.getByRole('dialog', { name: 'About Lopsy' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('heading', { name: 'Lopsy' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'License text' })).toHaveValue(/MIT License/);

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await settle(page);

    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  test('About Lopsy closes on a backdrop press but not on Escape', async ({ page }) => {
    await clickMenu(page, 'Help', 'About Lopsy');
    expect(await openDialogName(page)).toBe('About Lopsy');

    // Pinned as-is: no Escape handler, as with Keyboard Shortcuts.
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await openDialogName(page)).toBe('About Lopsy');

    await page.mouse.click(5, 700);
    await settle(page);
    expect(await openDialogName(page)).toBeNull();
  });

  test('Agents opens a separate tab with no opener and leaves the editor document as it was', async ({ page, context }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const before = await surfaceState(page);
    const id = await documentId(page);
    const hash = await layerPixelHash(page, before.activeLayerId!);

    const popupPromise = context.waitForEvent('page');
    await clickMenu(page, 'Help', 'Agents');
    const popup = await popupPromise;
    await popup.waitForLoadState();

    // window.open(..., 'noopener'): the new tab cannot reach the editor.
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(new URL(page.url()).pathname).toBe('/');
    expect(await documentId(page)).toBe(id);
    const after = await surfaceState(page);
    expect(after.layers).toEqual(before.layers);
    expect(after.selection).toEqual(before.selection);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await layerPixelHash(page, before.activeLayerId!)).toBe(hash);
    expect(await openDialogName(page)).toBeNull();
    await popup.close();
  });
});
