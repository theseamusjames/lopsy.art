import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, openBrushModal } from './helpers';

const DIALOG = '[role="dialog"][aria-label="Brushes"]';

// The stroke preview is the strip along the bottom of the Brushes modal,
// the dialog's only direct <canvas> child. Its backing store is sized by
// devicePixelRatio, so count over the whole backing store.
async function countPreviewInk(page: Page): Promise<number> {
  return page.evaluate((dialogSel) => {
    const dialog = document.querySelector(dialogSel);
    if (!dialog) return -1;
    const canvas = dialog.querySelector(':scope > canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return -1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! > 10) count++;
    }
    return count;
  }, DIALOG);
}

// The preview redraws 200ms after the last settings change; wait for the
// count to settle to the same value twice in a row.
async function settledPreviewInk(page: Page): Promise<number> {
  let previous = -2;
  let current = -1;
  await expect
    .poll(async () => {
      previous = current;
      current = await countPreviewInk(page);
      return current >= 0 && current === previous;
    }, { intervals: [300, 300, 300, 500, 500, 1000], timeout: 10_000 })
    .toBe(true);
  return current;
}

async function selectTab(page: Page, name: string) {
  await page.locator(`${DIALOG} [role="option"]:has-text("${name}")`).click();
}

async function selectTexture(page: Page, label: string) {
  await selectTab(page, 'Texture');
  await page.locator(`${DIALOG} select[title="Brush texture"]`).selectOption({ label });
}

async function selectBlendMode(page: Page, label: string) {
  await selectTab(page, 'Texture');
  await page.locator(`${DIALOG} select[title="Texture blend mode"]`).selectOption({ label });
}

test.describe('Brushes modal stroke preview with a texture (#1198)', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'brush modal is opened from the desktop options bar');
  });

  test('preview keeps the textured stroke for every texture and blend mode', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await page.keyboard.press('b');
    await openBrushModal(page);
    await selectTab(page, 'Presets');
    await page.locator(`${DIALOG} [aria-label="Brush preset: Hard Round"]`).click();

    const baseline = await settledPreviewInk(page);
    await page.screenshot({ path: 'e2e/screenshots/brush-stroke-preview-no-texture.png' });
    // A white S-curve of hard dabs across the strip.
    expect(baseline).toBeGreaterThan(1000);

    const multiply: Record<string, number> = {};
    for (const texture of ['Noise', 'Canvas', 'Grain']) {
      await selectTexture(page, texture);
      await selectBlendMode(page, 'Multiply');
      multiply[texture] = await settledPreviewInk(page);
      await page.screenshot({
        path: `e2e/screenshots/brush-stroke-preview-${texture.toLowerCase()}-multiply.png`,
      });
    }
    // The texture thins the stroke out but never erases it: before the fix
    // only the last tile's rectangle survived and the strip came out empty.
    for (const [texture, count] of Object.entries(multiply)) {
      expect(count, `${texture} multiply`).toBeGreaterThan(baseline * 0.1);
      expect(count, `${texture} multiply`).toBeLessThanOrEqual(baseline);
    }

    await selectTexture(page, 'Canvas');
    await selectBlendMode(page, 'Subtract');
    const subtract = await settledPreviewInk(page);
    await page.screenshot({ path: 'e2e/screenshots/brush-stroke-preview-canvas-subtract.png' });
    expect(subtract).toBeGreaterThan(baseline * 0.1);
    expect(subtract).toBeLessThanOrEqual(baseline);

    // brush_dab_footer.glsl overlays the texture onto the dab alpha:
    // overlay(1, t) = 1, so a hard round's solid core stays fully opaque
    // and the stroke keeps (almost) all of its coverage. Previewing it as
    // multiply would drop the same pixels the Canvas multiply case does.
    await selectBlendMode(page, 'Overlay');
    const overlay = await settledPreviewInk(page);
    await page.screenshot({ path: 'e2e/screenshots/brush-stroke-preview-canvas-overlay.png' });
    expect(overlay).toBeGreaterThan(baseline * 0.9);
    expect(overlay).toBeGreaterThan(multiply['Canvas']!);

    await selectTexture(page, 'No Texture');
    expect(await settledPreviewInk(page)).toBe(baseline);
  });
});
