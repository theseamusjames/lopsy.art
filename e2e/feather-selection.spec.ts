import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, docToScreen } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(200);
}

/** Read the current selection mask from the Zustand store (serialised). */
async function getSelectionMask(page: Page): Promise<{
  active: boolean;
  maskWidth: number;
  maskHeight: number;
  mask: number[] | null;
}> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          maskWidth: number;
          maskHeight: number;
          mask: Uint8ClampedArray | null;
        };
      };
    };
    const sel = store.getState().selection;
    return {
      active: sel.active,
      maskWidth: sel.maskWidth,
      maskHeight: sel.maskHeight,
      mask: sel.mask ? Array.from(sel.mask) : null,
    };
  });
}

/** Drag on the canvas to create a marquee selection. */
async function dragMarquee(
  page: Page,
  x0: number, y0: number,
  x1: number, y1: number,
) {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Click a magic wand at a given document coordinate. */
async function wandClick(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(300);
}

/** Open Select menu and click a named item. */
async function selectMenuItem(page: Page, itemLabel: string) {
  await page.click('text=Select');
  await page.waitForTimeout(100);
  await page.click(`text=${itemLabel}`);
  await page.waitForTimeout(200);
}

/** Apply the open FilterDialog by setting the amount slider and clicking Apply. */
async function applyFeatherDialog(page: Page, radius: number) {
  // The feather dialog reuses FilterDialog with a single "Radius (px)" slider
  const modal = page.locator('h2:has-text("Feather Selection")')
    .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
  await modal.waitFor({ state: 'visible', timeout: 5000 });
  const slider = modal.locator('input[type="range"]');
  await slider.fill(String(radius));
  await modal.locator('button:has-text("Apply")').click();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Feather Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('Select > Feather applies a soft Gaussian blur to the selection mask', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // 1. Create a rectangular marquee selection (50,50)→(150,150)
    await page.keyboard.press('m');
    await dragMarquee(page, 50, 50, 150, 150);

    const beforeSel = await getSelectionMask(page);
    expect(beforeSel.active).toBe(true);
    expect(beforeSel.mask).not.toBeNull();

    // Before feather: the mask should be binary (only 0 and 255)
    const beforeValues = new Set(beforeSel.mask!);
    expect(beforeValues.has(0)).toBe(true);
    expect(beforeValues.has(255)).toBe(true);
    expect(beforeValues.size).toBe(2); // strictly binary

    // 2. Apply feather via the Select menu
    await selectMenuItem(page, 'Feather…');
    await applyFeatherDialog(page, 10);

    // Screenshot for visual review
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'feather-selection-after.png') });

    // 3. After feather: the mask should have intermediate values (not just 0 and 255)
    const afterSel = await getSelectionMask(page);
    expect(afterSel.active).toBe(true);
    expect(afterSel.mask).not.toBeNull();

    const afterValues = new Set(afterSel.mask!);
    // There should be values other than 0 and 255 — intermediate pixels at the edges
    const hasIntermediateValues = [...afterValues].some(v => v > 0 && v < 255);
    expect(hasIntermediateValues).toBe(true);

    // Pixels well inside the selection should be near fully selected
    const w = afterSel.maskWidth;
    const centerVal = afterSel.mask![100 * w + 100]!;
    expect(centerVal).toBeGreaterThan(200);

    // Pixels well outside should remain unselected
    const outsideVal = afterSel.mask![5 * w + 5]!;
    expect(outsideVal).toBe(0);
  });

  test('Feather dialog appears under Select menu', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Create a selection first
    await page.keyboard.press('m');
    await dragMarquee(page, 40, 40, 160, 160);

    // Open the Select menu
    await page.click('text=Select');
    await page.waitForTimeout(100);

    // Screenshot the open Select menu
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'select-menu-with-feather.png') });

    // Feather… item should be visible in the menu
    const featherItem = page.locator('[role="menu"] button:has-text("Feather…")');
    await expect(featherItem).toBeVisible({ timeout: 3000 });

    // Click Feather to open the dialog
    await featherItem.click();
    await page.waitForTimeout(200);

    // The Feather Selection dialog should appear
    const dialog = page.locator('h2:has-text("Feather Selection")');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Screenshot the dialog
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'feather-selection-dialog.png') });

    // Cancel it
    const modal = dialog.locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    await modal.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(100);
  });
});

test.describe('Graduated Magic Wand', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('Graduated checkbox appears in Magic Wand options bar', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await fitToView(page);

    // Activate the wand tool
    await page.keyboard.press('w');
    await page.waitForTimeout(100);

    // Screenshot the options bar
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'wand-options-graduated.png') });

    // The "Graduated" checkbox should be in the options bar
    const graduatedCheckbox = page.locator('label:has-text("Graduated") input[type="checkbox"]');
    await expect(graduatedCheckbox).toBeVisible({ timeout: 3000 });
    // Default state is unchecked
    await expect(graduatedCheckbox).not.toBeChecked();
  });

  test('Graduated wand produces non-binary mask values with tolerance', async ({ page }) => {
    // Create a document with a gradient-like region so the wand finds
    // colours at varying distances from the seed
    await createDocument(page, 100, 100, false);
    await fitToView(page);

    // Draw a solid red square in the centre — with zero tolerance the wand
    // only selects pixels that exactly match; with high tolerance and a
    // uniform fill the binary mask is all-255. We paint a gradient manually
    // by writing pixel data directly so the wand encounters a colour ramp.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const s = store.getState();
      const id = s.document.activeLayerId;
      const w = s.document.width;
      const h = s.document.height;
      s.pushHistory('paint');
      const img = new ImageData(w, h);
      // Vertical gradient: top row pure red → bottom row orange
      for (let y = 0; y < h; y++) {
        const g = Math.round((y / (h - 1)) * 128); // green channel 0→128
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          img.data[idx] = 255;     // R
          img.data[idx + 1] = g;   // G
          img.data[idx + 2] = 0;   // B
          img.data[idx + 3] = 255; // A
        }
      }
      s.updateLayerPixelData(id, img);
    });
    await page.waitForTimeout(300);

    // 1. Binary wand (graduated OFF) at tolerance 80 — wand clicks top-centre
    await page.keyboard.press('w');
    await page.waitForTimeout(100);

    // Set tolerance to 80 via the options bar
    const toleranceInput = page.locator('role=toolbar >> [aria-label="Tolerance value"]').first();
    await toleranceInput.fill('80');
    await toleranceInput.press('Enter');
    await page.waitForTimeout(100);

    // Ensure graduated is OFF
    const graduatedCheckbox = page.locator('label:has-text("Graduated") input[type="checkbox"]');
    if (await graduatedCheckbox.isChecked()) {
      await graduatedCheckbox.click();
      await page.waitForTimeout(100);
    }

    // Click at (50, 5) — near the top, pure red [255,0,0]
    await wandClick(page, 50, 5);

    // Clear the transform overlay that the wand creates (per GUIDE.md pitfall #3)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setTransform: (t: null) => void };
      };
      store.getState().setTransform(null);
    });

    const binarySel = await getSelectionMask(page);
    expect(binarySel.active).toBe(true);
    expect(binarySel.mask).not.toBeNull();

    // Binary mode: mask should only contain 0 and 255
    const binaryValues = new Set(binarySel.mask!.filter(v => v > 0));
    const binaryHasIntermediate = [...binaryValues].some(v => v > 0 && v < 255);
    expect(binaryHasIntermediate).toBe(false);

    // Screenshot binary result
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'wand-binary-selection.png') });

    // 2. Graduated wand (graduated ON) — same click position, same tolerance
    await graduatedCheckbox.click();
    await page.waitForTimeout(100);
    await expect(graduatedCheckbox).toBeChecked();

    await wandClick(page, 50, 5);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setTransform: (t: null) => void };
      };
      store.getState().setTransform(null);
    });

    const graduatedSel = await getSelectionMask(page);
    expect(graduatedSel.active).toBe(true);
    expect(graduatedSel.mask).not.toBeNull();

    // Screenshot graduated result
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'wand-graduated-selection.png') });

    // Graduated mode: the mask should contain intermediate values
    const gradValues = new Set(graduatedSel.mask!);
    const gradHasIntermediate = [...gradValues].some(v => v > 0 && v < 255);
    expect(gradHasIntermediate).toBe(true);

    // Seed pixel (top) should be fully selected
    const seedVal = graduatedSel.mask![5 * graduatedSel.maskWidth + 50]!;
    expect(seedVal).toBe(255);
  });
});
