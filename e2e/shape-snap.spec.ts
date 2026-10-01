/**
 * The Shape tool's drag box snaps like a marquee: to the grid when Show Grid
 * and Snap are on, and to guides. The shape grows from its centre, so the
 * press point and the dragged corner both snap and every edge lands on a line.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, selectTool, docToScreen } from './helpers';

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Doc-space bounding box of the active layer's pixels with alpha > 127. */
async function opaqueBounds(page: Page): Promise<Bounds | null> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const res = await readFn(doc.activeLayerId);
    if (!res || res.width === 0 || !layer) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < res.height; y++) {
      for (let x = 0; x < res.width; x++) {
        if ((res.pixels[(y * res.width + x) * 4 + 3] ?? 0) <= 127) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (minX === Infinity) return null;
    return { minX: minX + layer.x, minY: minY + layer.y, maxX: maxX + layer.x, maxY: maxY + layer.y };
  });
}

async function chooseRectangle(page: Page): Promise<void> {
  await selectTool(page, 'shape');
  const toolbar = page.getByRole('toolbar', { name: 'Shape options' });
  await toolbar.locator('[aria-labelledby="shape-mode-label"]').selectOption({ label: 'Rectangle' });
  await toolbar.locator('[aria-labelledby="shape-output-label"]').selectOption('pixels');
}

async function dragFromCentre(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function viewMenu(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'View' }).click();
  await page.locator(`[role="menuitem"]:has-text("${item}")`).click();
  await page.waitForTimeout(100);
}

test.describe('Shape tool snapping', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar and rulers need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
  });

  test('with the grid and Snap on, a Rectangle dragged near grid points lands on grid lines', async ({ page }) => {
    // Show Grid also turns Snap on. The 16 px grid is centred on the 400 × 300
    // document: vertical lines at 200 ± 16k (… 72, 120, 168 …), horizontal
    // at 150 ± 16k (… 134, 150, 166 …).
    await viewMenu(page, 'Show Grid');
    await expect(page.getByRole('checkbox', { name: 'Snap', exact: true })).toBeChecked();
    await chooseRectangle(page);
    // Centre (123, 147) → (120, 150); corner (163, 172) → (168, 166).
    await dragFromCentre(page, { x: 123, y: 147 }, { x: 163, y: 172 });
    await page.screenshot({ path: 'e2e/screenshots/shape-snap-grid.png' });

    // Box 72..168 × 134..166; unsnapped it would be 83..163 × 122..172.
    expect(await opaqueBounds(page)).toEqual({ minX: 72, minY: 134, maxX: 167, maxY: 165 });
  });

  test('with Snap unticked the same drag is left where it was released', async ({ page }) => {
    await viewMenu(page, 'Show Grid');
    await page.getByRole('checkbox', { name: 'Snap', exact: true }).uncheck();
    await chooseRectangle(page);
    await dragFromCentre(page, { x: 123, y: 147 }, { x: 163, y: 172 });

    expect(await opaqueBounds(page)).toEqual({ minX: 83, minY: 122, maxX: 162, maxY: 171 });
  });

  test('the dragged edge lands on a guide', async ({ page }) => {
    // Cmd/Ctrl-click the top ruler at the middle: a guide at exactly x = 200.
    const container = await page.locator('[data-testid="canvas-container"]').boundingBox();
    if (!container) throw new Error('no canvas container');
    const { x } = await docToScreen(page, 200, 0);
    await page.keyboard.down('ControlOrMeta');
    await page.mouse.click(x, container.y + 10);
    await page.keyboard.up('ControlOrMeta');

    await chooseRectangle(page);
    await dragFromCentre(page, { x: 150, y: 150 }, { x: 196, y: 180 });
    await page.screenshot({ path: 'e2e/screenshots/shape-snap-guide.png' });

    // Right edge pulled 4 px onto the guide: x 100..200.
    expect(await opaqueBounds(page)).toEqual({ minX: 100, minY: 120, maxX: 199, maxY: 179 });
  });
});
