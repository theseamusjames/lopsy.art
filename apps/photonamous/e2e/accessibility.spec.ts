import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from './test';
import { axeViolations } from './axe';
import { generatedJpeg, importStrip, tiles, toast } from './library';
import { newMask } from './masks';

/**
 * Accessibility (WCAG 2.2 AA): axe-core's rules run on every view of the
 * app as a user reaches it, in the library on "This browser". A11Y_REPORT
 * names a JSON file to write every violation to. What only a build with
 * Google sign-in shows is in accessibility.drive.spec.ts.
 */

interface Violation {
  readonly state: string;
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: { readonly target: string; readonly html: string; readonly summary: string }[];
}

const found: Violation[] = [];

test.use({ actionTimeout: 15_000 });

async function scan(page: Page, state: string): Promise<void> {
  for (const v of await axeViolations(page)) found.push({ state, ...v });
}

async function step(page: Page, state: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
    await scan(page, state);
  } catch (error) {
    found.push({ state, id: 'step-failed', impact: null, help: String(error).slice(0, 300), nodes: [] });
  }
}

test.afterAll(() => {
  const report = process.env.A11Y_REPORT;
  if (report) writeFileSync(report, JSON.stringify(found, null, 2));
});

test('every view, as a user reaches it', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Photonamous' })).toBeVisible({ timeout: 15_000 });
  await scan(page, 'start screen');

  await step(page, 'empty library', async () => {
    await page.getByRole('button', { name: /This browser/ }).click();
    await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 15_000 });
  });

  await step(page, 'import menu', async () => {
    await page.getByRole('button', { name: /Import photos/ }).first().click();
    await expect(page.getByRole('menuitem', { name: /Choose photos/ })).toBeVisible({ timeout: 15_000 });
  });

  const files = [];
  for (const [i, hue] of [20, 140, 260].entries()) files.push({ name: `photo-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: await generatedJpeg(page, hue, 640, 480) });
  await step(page, 'import sheet', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Choose photos/ }).click();
    await (await chooser).setFiles(files);
    await expect(page.getByRole('button', { name: /^Import 3 photo/ })).toBeVisible({ timeout: 15_000 });
  });

  await step(page, 'import done, said in a toast', async () => {
    await page.getByRole('button', { name: /^Import 3 photo/ }).click();
    await expect(toast(page, /^Imported \d+ photo/)).toBeVisible({ timeout: 60_000 });
  });

  await step(page, 'library grid', async () => {
    await page.getByRole('button', { name: /^All photos/ }).click();
    await expect(tiles(page)).toHaveCount(3);
    await expect(tiles(page).first().locator('img')).toBeVisible({ timeout: 30_000 });
    // The status bar is scanned with the view it sits under: the count, the renderer and the display.
    await expect(page.getByTestId('status-renderer')).toBeVisible({ timeout: 30_000 });
  });

  await step(page, 'photo selected', async () => {
    await tiles(page).first().click();
    await page.keyboard.press('3');
    await expect(page.getByTestId('status-selected')).toBeVisible();
  });

  await step(page, 'Filters menu, one filter on', async () => {
    await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filters' }).getByRole('checkbox', { name: 'JPEG' }).check();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible({ timeout: 15_000 });
  });
  await page.getByRole('button', { name: 'Clear filters' }).click();

  await step(page, 'the filters in the row, in a wide window', async () => {
    await page.setViewportSize({ width: 1700, height: 800 });
    await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Rating/ }).click();
    await expect(page.getByRole('dialog', { name: 'Rating' })).toBeVisible({ timeout: 15_000 });
  });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });

  await step(page, 'More menu', async () => {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'More' })).toBeVisible({ timeout: 15_000 });
  });
  await page.keyboard.press('Escape');

  await step(page, 'photo actions menu', async () => {
    await tiles(page).first().click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Photo actions' })).toBeVisible({ timeout: 15_000 });
  });
  await page.keyboard.press('Escape');

  await step(page, 'sync panel', async () => {
    await page.getByRole('button', { name: /Saved/ }).click();
  });
  await page.keyboard.press('Escape');

  await step(page, 'keyboard shortcuts', async () => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  });
  await page.keyboard.press('Escape');

  await step(page, 'settings', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  });
  for (const section of ['Data', 'Cloud provider']) {
    await step(page, `settings, ${section}`, async () => {
      await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: section }).click();
    });
  }
  await page.keyboard.press('Escape');

  await step(page, 'export dialog', async () => {
    await tiles(page).first().click();
    await page.getByRole('banner').getByRole('button', { name: /^Export/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  });
  // The HDR formats: each with its help line, no colour choice, sizes that never enlarge; the gain-map JPEG with Quality.
  await step(page, 'export dialog, HDR JPEG', async () => {
    await page.getByRole('radio', { name: 'HDR JPEG (gain map)' }).check();
    await expect(page.getByRole('slider', { name: 'Quality' })).toBeVisible({ timeout: 15_000 });
  });
  await step(page, 'export dialog, HDR PNG', async () => {
    await page.getByRole('radio', { name: 'HDR PNG (16-bit, PQ)' }).check();
    await page.getByRole('combobox', { name: 'Size' }).selectOption('long');
    await expect(page.getByText('HDR files are never enlarged: a photo smaller than this stays as it is.')).toBeVisible({ timeout: 15_000 });
  });
  await page.keyboard.press('Escape');

  await step(page, 'new version dialog', async () => {
    await tiles(page).first().click({ button: 'right' });
    await page.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'New version' }).click();
    await expect(page.getByRole('dialog', { name: 'New version' })).toBeVisible({ timeout: 15_000 });
  });
  await page.keyboard.press('Escape');

  await step(page, 'copy edits dialog', async () => {
    await tiles(page).first().click();
    await page.keyboard.press('Control+Shift+C');
    await expect(page.getByRole('dialog', { name: /Copy edits/ })).toBeVisible({ timeout: 15_000 });
  });
  await page.keyboard.press('Escape');

  await step(page, 'compare view', async () => {
    await tiles(page).nth(0).click();
    await tiles(page).nth(1).click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: /^Two up/ }).click();
  });
  await page.keyboard.press('Escape');

  await step(page, 'single view', async () => {
    await tiles(page).first().dblclick();
  });
  await page.keyboard.press('Escape');

  await step(page, 'edit view', async () => {
    await tiles(page).first().click();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('edit-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('slider', { name: 'Exposure' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('status-photo-size')).toBeVisible({ timeout: 60_000 });
  });

  const edit = page.getByTestId('edit-view');
  await step(page, 'edit view, every group open', async () => {
    for (const toggle of await edit.locator('button[aria-expanded="false"]').all()) {
      if (await toggle.isVisible()) await toggle.click();
    }
  });

  await step(page, 'edit view, a section hidden by its eye', async () => {
    await edit.getByRole('button', { name: 'Hide Tone', exact: true }).click();
    await expect(page.getByTestId('hidden-badge')).toHaveText('Without Tone');
  });
  await edit.getByRole('button', { name: 'Hide Tone', exact: true }).click();

  await step(page, 'edit view, crop tool', async () => {
    await page.keyboard.press('r');
  });
  // The options dragged by their grip to the stage's top right corner, where they stay.
  await step(page, 'edit view, crop tool, options moved', async () => {
    const stage = await page.getByTestId('crop-tool').boundingBox();
    const bar = page.getByRole('group', { name: 'Crop options' });
    const grip = bar.getByRole('button', { name: 'Move crop options' });
    const g = await grip.boundingBox();
    if (!stage || !g) throw new Error('no crop options');
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width + 100, Math.max(1, stage.y - 100), { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => Math.round(((await bar.boundingBox())?.y ?? 0) - stage.y)).toBe(8);
  });
  await page.keyboard.press('Escape');

  await step(page, 'edit view, masks', async () => {
    await edit.getByRole('button', { name: 'Mask', exact: true }).click();
    await newMask(page, 'Radial');
  });

  await step(page, 'edit view, masks, colour grading added to one', async () => {
    await edit.getByRole('button', { name: 'Add adjustment', exact: true }).click();
    await page.getByRole('menu', { name: 'Adjustments' }).getByRole('menuitem', { name: 'Color grading', exact: true }).click();
    await expect(edit.getByRole('group', { name: 'Mask 1 color grading', exact: true })).toBeVisible();
  });

  await step(page, 'edit view, masks, one hidden by its eye', async () => {
    await edit.getByRole('button', { name: 'Hide Mask 1', exact: true }).click();
    await expect(edit.getByTestId('hidden-badge')).toHaveText('Without Mask 1');
  });
  await edit.getByRole('button', { name: 'Hide Mask 1', exact: true }).click();

  await step(page, 'edit view, masks, New mask menu open', async () => {
    await edit.getByRole('button', { name: 'New mask', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'New mask' })).toBeVisible();
  });
  await page.keyboard.press('Escape');

  await step(page, 'edit view, masks, renaming one', async () => {
    await edit.getByRole('button', { name: 'Rename Mask 1', exact: true }).click();
    await expect(edit.getByLabel('Mask name')).toBeFocused();
  });
  await page.keyboard.press('Escape');

  await step(page, 'edit view, masks, Show mask on', async () => {
    await page.getByRole('group', { name: 'Photo' }).focus();
    await page.keyboard.press('o');
  });

  await step(page, 'edit view, masks, Position open', async () => {
    const position = edit.getByRole('button', { name: 'Position', exact: true });
    await position.click();
    await expect(position).toHaveAttribute('aria-expanded', 'true');
  });

  await step(page, 'edit view, split before and after', async () => {
    await edit.getByRole('button', { name: 'Split' }).click();
  });

  await step(page, 'library after edit', async () => {
    await edit.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(tiles(page).first()).toBeVisible({ timeout: 15_000 });
  });

  await step(page, 'delete dialog', async () => {
    await tiles(page).last().click();
    await page.keyboard.press('Delete');
  });
  await page.keyboard.press('Escape');

  await step(page, 'check library', async () => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Data' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Check library' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Check library' })).toBeEnabled({ timeout: 30_000 });
  });
  await page.keyboard.press('Escape');

  // More than four versions: the ones not selected are in a dropdown, with the check and bin of the one it shows.
  // On the second photo: the steps above gave the first one a Radial mask in the Edit view.
  await step(page, 'single view, versions dropdown', async () => {
    await tiles(page).nth(1).dblclick();
    const versions = page.getByRole('group', { name: 'Versions' });
    for (let i = 0; i < 4; i++) {
      await versions.getByRole('button', { name: 'New version' }).click();
      await page.getByRole('dialog', { name: 'New version' }).getByRole('button', { name: 'Create' }).click();
      await expect(page.getByRole('dialog', { name: 'New version' })).toHaveCount(0);
    }
    await expect(versions.getByRole('combobox', { name: 'Other versions' })).toBeVisible({ timeout: 15_000 });
  });

  await step(page, 'cull view', async () => {
    await page.keyboard.press('f');
    await expect(page.getByRole('dialog', { name: /^Full screen: / })).toBeVisible({ timeout: 15_000 });
  });
  await page.keyboard.press('Escape');

  // An import that did not go cleanly keeps its strip, with what failed.
  await step(page, 'import strip with a failure', async () => {
    await page.getByRole('button', { name: /Import photos/ }).first().click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Choose photos/ }).click();
    await (await chooser).setFiles([{ name: 'not-a-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a photo') }]);
    await page.getByRole('button', { name: /^Import 1 photo/ }).click();
    await importStrip(page).getByRole('button', { name: /could not be imported/ }).click({ timeout: 60_000 });
    await expect(importStrip(page).getByText('not-a-photo.jpg')).toBeVisible({ timeout: 15_000 });
  });

  await step(page, 'grade screen', async () => {
    await page.goto('/?grade=missing');
  });

  expect(found).toEqual([]);
});
