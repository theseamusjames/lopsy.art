/**
 * White balance mode menu and picker on a JPEG (spec 5.4). The generated
 * test image has a neutral grey block in its centre, so picking it after a
 * warm Temperature brings the balance back to neutral. RAW presets and
 * Kelvin need a RAF and are covered by unit tests of their parsing.
 */
import { expect, test, type Page } from '@playwright/test';
import { openGeneratedImage, openHarness, waitForPreview, waitForReady } from './harness';

const steps = (page: Page) => page.evaluate(() => window.__photosHarness?.steps ?? []);

test.describe('White balance', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
  });

  test('the mode menu shows As shot, then Custom, and As shot puts it back as one step', async ({ page }) => {
    const mode = page.getByLabel('White balance mode');
    await expect(mode).toHaveValue('asShot');
    const temperature = page.getByLabel('Temperature value');
    await temperature.fill('40');
    await temperature.press('Enter');
    await expect(mode).toHaveValue('custom');
    await mode.selectOption('asShot');
    await expect(temperature).toHaveValue('0');
    expect(await steps(page)).toEqual(['Temperature +40', 'White balance: As shot']);
  });

  test('picking the neutral grey block takes the warm cast back out', async ({ page }) => {
    const temperature = page.getByLabel('Temperature value');
    await temperature.fill('40');
    await temperature.press('Enter');
    await page.getByRole('button', { name: 'Pick a neutral grey' }).click();
    const picker = page.getByTestId('white-balance-picker');
    await expect(picker).toBeVisible();
    const canvas = await page.getByTestId('edit-canvas').boundingBox();
    if (!canvas) throw new Error('no canvas');
    // The grey block fills the middle of the photo, which sits in the middle of the stage.
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await expect(picker).toHaveCount(0);
    await expect.poll(async () => Math.abs(Number((await temperature.inputValue()).replace('−', '-'))), { timeout: 10_000 }).toBeLessThanOrEqual(3);
    expect(await steps(page)).toEqual(['Temperature +40', 'White balance: picked']);
  });

  test('Esc leaves the picker without a change', async ({ page }) => {
    await page.getByRole('button', { name: 'Pick a neutral grey' }).click();
    await expect(page.getByTestId('white-balance-picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('white-balance-picker')).toHaveCount(0);
    expect(await steps(page)).toEqual([]);
  });
});
