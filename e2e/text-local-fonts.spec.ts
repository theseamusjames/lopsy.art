import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';
import { clickAtDoc } from './text-edit-helpers';

// Fonts that ship with macOS, look nothing like Inter, and each trip a
// cosmic-text matching quirk the engine has to absorb: Zapfino's only face is
// flagged italic, Impact declares itself condensed. Impact is also in the
// static catalog, so it doubles as the "local shadows catalog" check. Every
// installed candidate is exercised; a trimmed font install skips rather than
// fails.
const CANDIDATE_FAMILIES = ['Zapfino', 'Impact'];

const LOCAL_HEADER = /^Local\d+$/;

async function openFontPicker(page: Page): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').first().click();
  await page.locator('input[aria-label="Search fonts"]').waitFor({ state: 'visible' });
}

function localHeader(page: Page) {
  return page.locator('[role="listbox"] div').filter({ hasText: LOCAL_HEADER }).first();
}

async function countOpaquePixels(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
    if (!result || result.width === 0) return 0;
    let count = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      if ((result.pixels[i] ?? 0) > 10) count++;
    }
    return count;
  }, layerId);
}

async function getTextLayerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string }> } };
    };
    return store.getState().document.layers.filter((l) => l.type === 'text').map((l) => l.id);
  });
}

async function commitText(page: Page, docX: number, docY: number, text: string): Promise<string> {
  const before = new Set(await getTextLayerIds(page));
  await clickAtDoc(page, docX, docY);
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(300);
  const added = (await getTextLayerIds(page)).filter((id) => !before.has(id));
  expect(added).toHaveLength(1);
  return added[0]!;
}

test.describe('Local fonts (Local Font Access API)', () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Local Font Access API is Chromium-only');
  });

  test('installed fonts are listed under Local and render on the canvas', async ({ page, context }) => {
    await context.grantPermissions(['local-fonts']);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);
    await page.keyboard.press('t');

    // Baseline: the same word in the bundled Inter.
    const interLayerId = await commitText(page, 200, 150, 'LOPSY');
    const interCount = await countOpaquePixels(page, interLayerId);
    expect(interCount).toBeGreaterThan(50);

    // Hide it so the next click does not re-open it for editing, and move
    // off it so the font change does not apply to the committed layer.
    await page.locator(`[data-layer-id="${interLayerId}"]`)
      .locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]')
      .click();
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(100);

    // The editor-load query has had time to finish: the group is there with
    // at least one family, and no manual load is offered.
    await openFontPicker(page);
    const header = localHeader(page);
    await expect(header).toBeVisible({ timeout: 15000 });
    const headerText = (await header.textContent())?.trim() ?? '';
    const localCount = Number(LOCAL_HEADER.exec(headerText) ? headerText.slice('Local'.length) : '0');
    expect(localCount).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Load local fonts' })).toHaveCount(0);

    await page.keyboard.press('Escape');

    const tested: string[] = [];
    for (const family of CANDIDATE_FAMILIES) {
      await openFontPicker(page);
      await page.locator('input[aria-label="Search fonts"]').fill(family);
      await page.waitForTimeout(150);
      const row = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) });
      if ((await row.count()) === 0) {
        await page.keyboard.press('Escape');
        continue;
      }
      // Exactly one row: a family both installed and in the catalog (Impact)
      // must be listed once, under Local, not twice.
      await expect(row).toHaveCount(1);
      await expect(localHeader(page)).toBeVisible();
      await row.click();
      await expect(page.locator('button[aria-haspopup="listbox"]').first()).toContainText(family);

      // Picking a local family hands its bytes to the engine's font database.
      await page.waitForFunction(
        (f) => {
          const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((n: string) => boolean) | undefined;
          return fn ? fn(f) : false;
        },
        family,
        { timeout: 15000 },
      );

      const layerId = await commitText(page, 200, 150, 'LOPSY');
      const localPixels = await countOpaquePixels(page, layerId);
      await page.screenshot({ path: `e2e/screenshots/text-local-font-${family.toLowerCase()}.png` });

      // Different glyph shapes → different coverage. Equal counts would mean
      // the local family silently fell back to Inter.
      expect(localPixels, `${family} rendered no glyphs`).toBeGreaterThan(50);
      expect(localPixels, `${family} fell back to Inter`).not.toBe(interCount);
      tested.push(family);

      await page.locator(`[data-layer-id="${layerId}"]`)
        .locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]')
        .click();
      await page.locator('[aria-label="Add Layer"]').click();
      await page.waitForTimeout(100);
    }
    test.skip(tested.length === 0, `neither ${CANDIDATE_FAMILIES.join(' nor ')} is installed here`);
  });

  test('offers a manual load when the browser withholds local fonts', async ({ page }) => {
    // No permission granted: Chromium answers the automatic query with an
    // empty list, so the picker must show the button instead of a group.
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);
    await page.keyboard.press('t');

    await openFontPicker(page);
    await expect(page.getByRole('button', { name: 'Load local fonts' })).toBeVisible();
    await expect(localHeader(page)).toHaveCount(0);

    // Searching the catalog still works around the button.
    await page.locator('input[aria-label="Search fonts"]').fill('Pacifico');
    await expect(page.locator('[role="option"]').filter({ hasText: /^Pacifico$/ })).toHaveCount(1);
  });
});
