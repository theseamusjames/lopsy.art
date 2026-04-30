import { test, expect } from './fixtures';
import { waitForStore, createDocument } from './helpers';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = resolve(__dirname, 'fixtures', 'reference-test.png');

test.describe('Reference Image Panel', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('opens the panel and shows empty drop zone', async ({ page }) => {
    await page.locator('button[title="Reference"]').click();

    const dropZone = page.locator('[data-testid="reference-drop-zone"]');
    await expect(dropZone).toBeVisible();
    await expect(dropZone).toContainText('Drop an image here');

    await page.screenshot({ path: 'e2e/screenshots/reference-panel-empty.png' });
  });

  test('loads an image via file input and displays it', async ({ page }) => {
    await page.locator('button[title="Reference"]').click();

    await page.screenshot({ path: 'e2e/screenshots/reference-panel-before.png' });

    const fileInput = page.locator('[data-testid="reference-file-input"]');
    await fileInput.setInputFiles(TEST_IMAGE);

    const viewer = page.locator('[data-testid="reference-viewer"]');
    await expect(viewer).toBeVisible();

    const preview = page.locator('[data-testid="reference-preview"]');
    await expect(preview).toBeVisible();

    const img = preview.locator('img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'reference-test.png');

    await page.screenshot({ path: 'e2e/screenshots/reference-panel-after.png' });
  });

  test('opacity slider changes image visibility', async ({ page }) => {
    await page.locator('button[title="Reference"]').click();

    await page.locator('[data-testid="reference-file-input"]').setInputFiles(TEST_IMAGE);

    const viewer = page.locator('[data-testid="reference-viewer"]');
    await expect(viewer).toBeVisible();

    const img = page.locator('[data-testid="reference-preview"] img');
    const opacityBefore = await img.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacityBefore)).toBeCloseTo(1, 1);

    const opacityInput = page.locator('[aria-label="Opacity value"]');
    await opacityInput.click();
    await opacityInput.fill('50');
    await opacityInput.press('Enter');

    const opacityAfter = await img.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacityAfter)).toBeCloseTo(0.5, 1);

    await page.screenshot({ path: 'e2e/screenshots/reference-panel-opacity.png' });
  });

  test('flip buttons toggle image mirroring', async ({ page }) => {
    await page.locator('button[title="Reference"]').click();

    await page.locator('[data-testid="reference-file-input"]').setInputFiles(TEST_IMAGE);

    const viewer = page.locator('[data-testid="reference-viewer"]');
    await expect(viewer).toBeVisible();

    const img = page.locator('[data-testid="reference-preview"] img');
    const transformBefore = await img.evaluate((el) => el.style.transform);

    await page.locator('button[title="Flip horizontal"]').click();

    const transformAfterFlipH = await img.evaluate((el) => el.style.transform);
    expect(transformAfterFlipH).not.toBe(transformBefore);
    expect(transformAfterFlipH).toContain('-');

    await page.screenshot({ path: 'e2e/screenshots/reference-panel-flipped.png' });
  });

  test('remove button deletes the image and shows drop zone again', async ({ page }) => {
    await page.locator('button[title="Reference"]').click();

    await page.locator('[data-testid="reference-file-input"]').setInputFiles(TEST_IMAGE);

    const viewer = page.locator('[data-testid="reference-viewer"]');
    await expect(viewer).toBeVisible();

    await page.locator('button[title="Remove image"]').click();

    const dropZone = page.locator('[data-testid="reference-drop-zone"]');
    await expect(dropZone).toBeVisible();
  });

  test('panel toggle hides and shows the panel', async ({ page }) => {
    const toggleBtn = page.locator('button[title="Reference"]');
    await toggleBtn.click();

    const dropZone = page.locator('[data-testid="reference-drop-zone"]');
    await expect(dropZone).toBeVisible();

    await toggleBtn.click();
    await expect(dropZone).not.toBeVisible();
  });
});
