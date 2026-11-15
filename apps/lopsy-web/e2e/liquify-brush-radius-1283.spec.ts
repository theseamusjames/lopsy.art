import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  waitForStore,
  createDocument,
  getEditorState,
  selectTool,
  setForegroundColor,
  docToScreen,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

const BRUSH_SIZE = 100;
const RADIUS = BRUSH_SIZE / 2;
const DRAG_Y = 400;
const DRAG_X0 = 360;
const DRAG_X1 = 440;
const REGION = { x: 200, y: 200, w: 400, h: 400 };

async function fillStripe(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(50);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(50);
}

/** Alpha of a layer over a doc-space region, row-major; 0 outside the layer. */
async function readRegionAlpha(page: Page, layerId: string): Promise<number[]> {
  return page.evaluate(
    async ({ lid, region }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
      };
      const layer = store.getState().document.layers.find((l) => l.id === lid);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const { width, height, pixels } = await readFn(lid);
      const out: number[] = [];
      for (let dy = region.y; dy < region.y + region.h; dy++) {
        for (let dx = region.x; dx < region.x + region.w; dx++) {
          const x = dx - lx;
          const y = dy - ly;
          const inside = x >= 0 && y >= 0 && x < width && y < height;
          out.push(inside ? (pixels[(y * width + x) * 4 + 3] ?? 0) : 0);
        }
      }
      return out;
    },
    { lid: layerId, region: REGION },
  );
}

function distanceToDragLine(x: number, y: number): number {
  const cx = Math.min(DRAG_X1, Math.max(DRAG_X0, x));
  return Math.hypot(x - cx, y - DRAG_Y);
}

test.describe('Liquify warp stays inside the brush circle (#1283)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'liquify panel not fully accessible on narrow viewport');
    await page.goto('/');
    await waitForStore(page);
  });

  test('Push Forward reaches Brush Size / 2, not Brush Size', async ({ page }) => {
    await createDocument(page, 800, 800, false);
    const state = await getEditorState(page);
    const layer1 = state.document.layers.find((l) => l.name === 'Layer 1');
    if (!layer1) throw new Error('Layer 1 not found');

    // Vertical black stripes, 20px wide every 40px, across the drag area.
    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'marquee-rect');
    for (let x = 220; x < 580; x += 40) {
      await fillStripe(page, x, 220, x + 20, 580);
    }

    const before = await readRegionAlpha(page, layer1.id);
    expect(before.filter((a) => a > 128).length).toBeGreaterThan(9 * 20 * 300);

    await page.click('text=Filter');
    await page.click('text=Liquify...');
    const panel = page.locator('[data-testid="liquify-panel"]');
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    await panel.locator('select[aria-label="Liquify mode"]').selectOption('push');
    await panel.locator('input[aria-label="Brush size"]').fill(String(BRUSH_SIZE));
    await panel.locator('input[aria-label="Brush pressure"]').fill('100');
    await expect(panel).toContainText(String(BRUSH_SIZE));
    await expect(panel).toContainText('100%');

    const start = await docToScreen(page, DRAG_X0, DRAG_Y);
    const end = await docToScreen(page, DRAG_X1, DRAG_Y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.locator('[data-testid="liquify-apply"]').click();
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-brush-radius-1283.png') });

    const after = await readRegionAlpha(page, layer1.id);
    let maxChangedDistance = 0;
    let maxChangedRowOffset = 0;
    let changedInside = 0;
    for (let i = 0; i < after.length; i++) {
      if (Math.abs((after[i] ?? 0) - (before[i] ?? 0)) <= 32) continue;
      const x = REGION.x + (i % REGION.w);
      const y = REGION.y + Math.floor(i / REGION.w);
      maxChangedDistance = Math.max(maxChangedDistance, distanceToDragLine(x, y));
      maxChangedRowOffset = Math.max(maxChangedRowOffset, Math.abs(y - DRAG_Y));
      if (distanceToDragLine(x, y) < RADIUS * 0.6) changedInside++;
    }

    // The warp did something inside the brush circle...
    expect(changedInside).toBeGreaterThan(500);
    // ...and nothing beyond it. Before the fix the GPU dab used Brush Size
    // as the radius, so rows up to ~87px from the drag line changed.
    expect(maxChangedDistance).toBeLessThanOrEqual(RADIUS + 2);
    expect(maxChangedRowOffset).toBeLessThanOrEqual(RADIUS + 2);
  });
});
