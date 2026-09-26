import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument, drawRect, getPixelAt, docToScreen, selectTool } from './helpers';

// Three colors that are deliberately absent from the default palette, so
// every one of them must come from the extraction and not from the defaults.
const ORANGE = { r: 255, g: 87, b: 34 };
const JADE = { r: 40, g: 180, b: 160 };
const VIOLET = { r: 90, g: 60, b: 200 };

function hex(c: { r: number; g: number; b: number }): string {
  return `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

async function openSwatchesPanel(page: Page) {
  await page.locator('button[title="Swatches"]').click();
  const grid = page.getByTestId('swatches-grid');
  await expect(grid).toBeVisible();
  return grid;
}

function swatchButtons(page: Page) {
  return page.getByTestId('swatches-grid').locator('button');
}

function swatchFor(page: Page, c: { r: number; g: number; b: number }) {
  return page.getByTestId('swatches-grid').locator(`button[aria-label*="${hex(c)}"]`);
}

async function screenshotPanel(page: Page, path: string) {
  const panel = page.getByTestId('swatches-grid').locator('xpath=..');
  await panel.screenshot({ path });
}

test.describe('Swatches panel', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'panel requires the dock, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('extracts the image colors into the palette and paints with a picked swatch', async ({ page }) => {
    await drawRect(page, 20, 30, 110, 110, ORANGE);
    await drawRect(page, 145, 30, 110, 110, JADE);
    await drawRect(page, 270, 30, 110, 110, VIOLET);

    await openSwatchesPanel(page);
    await expect(swatchButtons(page)).toHaveCount(24);
    await page.screenshot({ path: 'e2e/screenshots/swatches-panel-before.png' });
    await screenshotPanel(page, 'e2e/screenshots/swatches-panel-ui-before.png');

    // Four boxes over an image with exactly four flat colors (white + three
    // rects) recovers each color exactly. White is already a default swatch,
    // so only the three rect colors are appended.
    await page.getByLabel('Colors to extract').selectOption('4');
    await page.getByRole('button', { name: 'Extract Colors from Image' }).click();
    await expect(swatchButtons(page)).toHaveCount(27);
    await expect(swatchFor(page, ORANGE)).toHaveCount(1);
    await expect(swatchFor(page, JADE)).toHaveCount(1);
    await expect(swatchFor(page, VIOLET)).toHaveCount(1);
    await expect(page.getByText('Added 3 colors from the image')).toBeVisible();

    // Extracted swatches are hue-sorted: orange (~14°) < jade (~171°) < violet (~249°).
    const labels = await swatchButtons(page).evaluateAll((els) =>
      els.slice(24).map((el) => el.getAttribute('aria-label')),
    );
    expect(labels).toEqual([`Swatch ${hex(ORANGE)}`, `Swatch ${hex(JADE)}`, `Swatch ${hex(VIOLET)}`]);

    // Re-extracting adds nothing — every color is already present.
    await page.getByRole('button', { name: 'Extract Colors from Image' }).click();
    await expect(swatchButtons(page)).toHaveCount(27);

    // Click the violet swatch → it becomes the foreground color…
    await swatchFor(page, VIOLET).click();
    await expect(page.locator('[aria-label="Hex color value"]')).toHaveValue('5a3cc8');
    await expect(swatchFor(page, VIOLET)).toHaveAttribute('aria-pressed', 'true');

    // …and a fill in the untouched strip along the bottom paints with it.
    await selectTool(page, 'marquee-rect');
    const start = await docToScreen(page, 20, 170);
    const end = await docToScreen(page, 380, 270);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await selectTool(page, 'fill');
    const center = await docToScreen(page, 200, 220);
    await page.mouse.click(center.x, center.y);
    await page.keyboard.press('Control+d');

    const filled = await getPixelAt(page, 200, 220);
    expect(filled).toEqual({ ...VIOLET, a: 255 });
    // The marquee confined the fill: the gap above it stays transparent on
    // the paint layer (the white comes from the background layer below), and
    // the jade rect is untouched.
    expect((await getPixelAt(page, 200, 160)).a).toBe(0);
    expect(await getPixelAt(page, 200, 85)).toEqual({ ...JADE, a: 255 });

    await page.screenshot({ path: 'e2e/screenshots/swatches-panel-after.png' });
    await screenshotPanel(page, 'e2e/screenshots/swatches-panel-ui-after.png');
  });

  test('Cmd/Ctrl-click sets the background color and Alt-click deletes a swatch', async ({ page }) => {
    await openSwatchesPanel(page);
    const teal = { r: 0, g: 137, b: 123 };

    await swatchFor(page, teal).click({ modifiers: ['ControlOrMeta'] });
    const bg = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { backgroundColor: { r: number; g: number; b: number } };
      };
      const { r, g, b } = store.getState().backgroundColor;
      return { r, g, b };
    });
    expect(bg).toEqual(teal);

    await swatchFor(page, teal).click({ modifiers: ['Alt'] });
    await expect(swatchFor(page, teal)).toHaveCount(0);
    await expect(swatchButtons(page)).toHaveCount(23);
  });

  test('added swatches survive a reload', async ({ page }) => {
    await openSwatchesPanel(page);
    await page.locator('[aria-label="Hex color value"]').fill('123abc');
    await page.locator('[aria-label="Hex color value"]').press('Enter');
    await page.getByRole('button', { name: 'Add Foreground Color' }).click();
    await expect(swatchFor(page, { r: 0x12, g: 0x3a, b: 0xbc })).toHaveCount(1);

    await page.reload();
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    // Whether the panel itself reopens depends on the dock layout's own
    // persistence; this test is about the swatch list, so open it if needed.
    if (!(await page.getByTestId('swatches-grid').isVisible())) await openSwatchesPanel(page);
    await expect(swatchFor(page, { r: 0x12, g: 0x3a, b: 0xbc })).toHaveCount(1);
    await expect(swatchButtons(page)).toHaveCount(25);
  });

  test('imports and exports GIMP .gpl palettes', async ({ page }) => {
    await openSwatchesPanel(page);

    await page.getByTestId('swatches-file-input').setInputFiles({
      name: 'sunset.gpl',
      mimeType: 'text/plain',
      buffer: Buffer.from('GIMP Palette\nName: Sunset\n#\n 45  27  78\tNight\n250 130  70\tEmber\n  0   0   0\tBlack\n'),
    });
    await expect(page.getByText('Imported 2 swatches from "Sunset"')).toBeVisible();
    await expect(page.getByTestId('swatches-grid').getByLabel('Swatch Night (#2d1b4e)')).toBeVisible();
    await expect(page.getByTestId('swatches-grid').getByLabel('Swatch Ember (#fa8246)')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Palette (.gpl)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('lopsy-swatches.gpl');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text.startsWith('GIMP Palette\n')).toBe(true);
    expect(text).toContain(' 45  27  78\tNight');
    expect(text).toContain('250 130  70\tEmber');
    expect(text.trim().split('\n').filter((l) => /^\s*\d/.test(l))).toHaveLength(26);
  });

  test('an invalid palette file shows an error toast and leaves the palette untouched', async ({ page }) => {
    await openSwatchesPanel(page);
    await page.getByTestId('swatches-file-input').setInputFiles({
      name: 'bad.gpl',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a palette\n1 2 3\n'),
    });
    await expect(page.getByText(/Failed to import palette: Not a GIMP palette/)).toBeVisible();
    await expect(swatchButtons(page)).toHaveCount(24);
  });
});
