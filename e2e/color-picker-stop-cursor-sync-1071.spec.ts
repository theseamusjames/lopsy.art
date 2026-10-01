/**
 * #1071 — the shared ColorPicker's SV and hue cursors must show the colour of
 * the gradient stop that is selected *now*, not the previously selected one.
 *
 * The picker used to sync its HSV from the `color` prop in an effect, after
 * the render that positioned the cursors, so they lagged one selection
 * behind. Both editors that host the picker are covered: the Gradient tool's
 * Advanced… dialog and the Gradient Map adjustment node.
 */
import { test, expect, type Page, type Locator } from './fixtures';
import { waitForStore, createDocument, getEditorState } from './helpers';

interface CursorFraction {
  x: number;
  y: number;
}

/** Where the SV cursor's centre sits inside the SV square, as 0–1 fractions. */
async function svCursorFraction(picker: Locator): Promise<CursorFraction> {
  const area = picker.getByRole('slider', { name: 'Saturation and brightness' });
  const areaBox = await area.boundingBox();
  const cursorBox = await area.locator('div').first().boundingBox();
  expect(areaBox).not.toBeNull();
  expect(cursorBox).not.toBeNull();
  return {
    x: (cursorBox!.x + cursorBox!.width / 2 - areaBox!.x) / areaBox!.width,
    y: (cursorBox!.y + cursorBox!.height / 2 - areaBox!.y) / areaBox!.height,
  };
}

/** Where the hue cursor's centre sits along the hue strip, as a 0–1 fraction. */
async function hueCursorFraction(picker: Locator): Promise<number> {
  const strip = picker.getByRole('slider', { name: 'Hue' });
  const stripBox = await strip.boundingBox();
  const cursorBox = await strip.locator('div').first().boundingBox();
  expect(stripBox).not.toBeNull();
  expect(cursorBox).not.toBeNull();
  return (cursorBox!.x + cursorBox!.width / 2 - stripBox!.x) / stripBox!.width;
}

/** The Gradient Map node is taller than the drawer, so scroll each target in first. */
async function clickAt(page: Page, target: Locator, fx: number, fy: number): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * fx, box!.y + box!.height * fy);
}

test.describe('ColorPicker cursors follow the selected gradient stop (#1071)', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'gradient editors need the desktop options bar and drawer');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('Gradient tool → Advanced…: selecting the white stop moves the SV cursor to white', async ({ page }) => {
    await page.locator('[data-tool-id="gradient"]').click();
    await page.getByTestId('gradient-advanced-btn').click();
    const dialog = page.getByRole('dialog', { name: 'Gradient Editor' });
    await expect(dialog).toBeVisible();
    const picker = dialog.getByRole('group', { name: 'Color picker' });
    const sv = picker.getByRole('slider', { name: 'Saturation and brightness' });

    // Default stops are black → white. Stop 1 (black) is selected on open:
    // the cursor sits at the bottom of the square.
    await dialog.getByTestId('gradient-stop-0').click();
    await expect(dialog.getByText('Stop 1 of 2')).toBeVisible();
    await expect(sv).toHaveAttribute('aria-valuetext', 'Saturation 0%, Brightness 0%');
    const black = await svCursorFraction(picker);
    expect(black.x).toBeCloseTo(0, 1);
    expect(black.y).toBeCloseTo(1, 1);

    // Select stop 2 (white): the cursor must jump to the top-left at once.
    await dialog.getByTestId('gradient-stop-1').click();
    await expect(dialog.getByText('Stop 2 of 2')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/color-picker-1071-gradient-white-stop.png' });
    await expect(sv).toHaveAttribute('aria-valuetext', 'Saturation 0%, Brightness 100%');
    const white = await svCursorFraction(picker);
    expect(white.x).toBeCloseTo(0, 1);
    expect(white.y).toBeCloseTo(0, 1);

    // And back to black, again without a one-selection lag.
    await dialog.getByTestId('gradient-stop-0').click();
    await expect(sv).toHaveAttribute('aria-valuetext', 'Saturation 0%, Brightness 0%');
    const blackAgain = await svCursorFraction(picker);
    expect(blackAgain.y).toBeCloseTo(1, 1);
  });

  test('Gradient Map: hue and SV cursors track a chromatic stop and a white stop', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = (await getEditorState(page)).document.activeLayerId!;
    await page.locator(`[data-layer-id="${groupId}"]`).locator('button[aria-label*="effects"]').click();
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer).toBeVisible();
    await page.locator('[aria-label="Add Adjustment"]').click();
    const item = page.getByRole('menuitem', { name: 'Gradient Map', exact: true });
    await item.waitFor({ state: 'visible', timeout: 3000 });
    await item.click();

    const picker = drawer.getByRole('group', { name: 'Color picker' });
    const sv = picker.getByRole('slider', { name: 'Saturation and brightness' });
    const hue = picker.getByRole('slider', { name: 'Hue' });

    // Turn stop 1 (black) into a saturated blue: hue strip at 60 %, then the
    // top-right corner of the SV square.
    await drawer.getByTestId('gradient-stop-0').click();
    await expect(drawer.getByText('Stop 1 of 2')).toBeVisible();
    await clickAt(page, hue, 0.6, 0.5);
    await clickAt(page, sv, 0.98, 0.02);
    const blueHue = Number(await hue.getAttribute('aria-valuenow'));
    expect(blueHue).toBeGreaterThan(200);
    expect(blueHue).toBeLessThan(230);
    const blue = await svCursorFraction(picker);
    expect(blue.x).toBeGreaterThan(0.9);
    expect(blue.y).toBeLessThan(0.1);

    // Select stop 2 (white). The SV cursor must sit at the top-left, not stay
    // on stop 1's top-right blue.
    await drawer.getByTestId('gradient-stop-1').click();
    await expect(drawer.getByText('Stop 2 of 2')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/color-picker-1071-gradient-map-white-stop.png' });
    await expect(sv).toHaveAttribute('aria-valuetext', 'Saturation 0%, Brightness 100%');
    const white = await svCursorFraction(picker);
    expect(white.x).toBeLessThan(0.05);
    expect(white.y).toBeLessThan(0.05);

    // Back to stop 1: the cursors return to blue straight away.
    await drawer.getByTestId('gradient-stop-0').click();
    await expect(drawer.getByText('Stop 1 of 2')).toBeVisible();
    await expect(sv).toHaveAttribute('aria-valuetext', /^Saturation (9\d|100)%, Brightness (9\d|100)%$/);
    expect(Math.abs(Number(await hue.getAttribute('aria-valuenow')) - blueHue)).toBeLessThanOrEqual(2);
    const blueAgain = await svCursorFraction(picker);
    expect(blueAgain.x).toBeGreaterThan(0.9);
    expect(blueAgain.y).toBeLessThan(0.1);
    expect(await hueCursorFraction(picker)).toBeCloseTo(blueHue / 360, 1);
  });
});
