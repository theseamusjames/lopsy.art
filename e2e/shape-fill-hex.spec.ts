/**
 * The Shape tool's Fill and Stroke popovers take a typed hex value, so an
 * exact brand colour can be set without eyeballing the HSV picker.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, getPixelAt, selectTool } from './helpers';

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + rect.width / 2;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + rect.height / 2;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function dragShape(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

test('typing a hex value into the Fill popover sets the shape fill', async ({ page }) => {
  await selectTool(page, 'shape');
  await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');

  await page.locator('role=toolbar >> [aria-label^="Color: rgb"]').first().click();
  const hex = page.locator('[aria-label="Fill hex color"]');
  await expect(hex).toBeVisible();
  await hex.fill('FF7EC8');
  await hex.press('Enter');
  await expect(page.locator('role=toolbar >> [aria-label="Color: rgb(255, 126, 200)"]')).toBeVisible();

  await dragShape(page, { x: 200, y: 150 }, { x: 260, y: 200 });

  const centre = await getPixelAt(page, 200, 150);
  expect(centre).toMatchObject({ r: 255, g: 126, b: 200, a: 255 });
});

test('an invalid hex value is rejected and the field reverts', async ({ page }) => {
  await selectTool(page, 'shape');
  await page.locator('role=toolbar >> [aria-label^="Color: rgb"]').first().click();
  const hex = page.locator('[aria-label="Fill hex color"]');
  const before = await hex.inputValue();

  await hex.fill('XYZ12');
  await hex.press('Enter');
  await expect(hex).toHaveValue(before);
});

test('the Stroke popover has its own hex field', async ({ page }) => {
  await selectTool(page, 'shape');
  await page.locator('button[aria-label="Add stroke color"]').click();
  const hex = page.locator('[aria-label="Stroke hex color"]');
  await expect(hex).toBeVisible();
  await hex.fill('#141414');
  await hex.press('Enter');
  await expect(page.locator('role=toolbar >> [aria-label="Color: rgb(20, 20, 20)"]')).toBeVisible();
});
