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

const CX = 800;
const CY = 200;

async function selectRect(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(50);
}

async function fillBar(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectRect(page, x0, y0, x1, y1);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(50);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(50);
}

/**
 * Black grid of 4px bars: verticals at x = 638 + 40k (y 20..380) and
 * horizontals at y = 38 + 40k (x 620..980), k = 0..8. The central
 * vertical bar covers x ∈ [798, 802) and the central horizontal bar
 * y ∈ [198, 202), so they cross exactly at (800, 200).
 */
async function drawGrid(page: Page): Promise<void> {
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'marquee-rect');
  for (let k = 0; k <= 8; k++) {
    const x = 638 + 40 * k;
    await fillBar(page, x, 20, x + 4, 380);
  }
  for (let k = 0; k <= 8; k++) {
    const y = 38 + 40 * k;
    await fillBar(page, 620, y, 980, y + 4);
  }
}

/** Dark (opaque, r < 128) runs along a doc-space row or column of a layer. */
async function darkRuns(
  page: Page,
  layerId: string,
  axis: 'row' | 'col',
  at: number,
  from: number,
  to: number,
): Promise<Array<[number, number]>> {
  return page.evaluate(
    async ({ lid, axis, at, from, to }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
      };
      const layer = store.getState().document.layers.find((l) => l.id === lid);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const { width, height, pixels } = await readFn(lid);
      const isDark = (dx: number, dy: number) => {
        const x = dx - lx;
        const y = dy - ly;
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const i = (y * width + x) * 4;
        return (pixels[i + 3] ?? 0) > 128 && (pixels[i] ?? 255) < 128;
      };
      const runs: Array<[number, number]> = [];
      let start = -1;
      for (let t = from; t <= to; t++) {
        const dark = axis === 'row' ? isDark(t, at) : isDark(at, t);
        if (dark && start < 0) start = t;
        if (!dark && start >= 0) {
          runs.push([start, t - 1]);
          start = -1;
        }
      }
      if (start >= 0) runs.push([start, to]);
      return runs;
    },
    { lid: layerId, axis, at, from, to },
  );
}

test.describe('Liquify Bloat keeps the image continuous (#945)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'liquify panel not fully accessible on narrow viewport');
    await page.goto('/');
    await waitForStore(page);
  });

  test('a single Bloat dab magnifies a grid crossing without folding it', async ({ page }) => {
    await createDocument(page, 1600, 400, false);
    const state = await getEditorState(page);
    const layer1 = state.document.layers.find((l) => l.name === 'Layer 1');
    if (!layer1) throw new Error('Layer 1 not found');

    await drawGrid(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-bloat-grid-before.png') });

    // Fixture sanity: the horizontal bar runs unbroken through the centre
    // row, the vertical bar through the centre column, and the row at
    // y = 180 (between horizontal bars) crosses five 4px vertical bars.
    expect(await darkRuns(page, layer1.id, 'row', CY, 700, 900)).toEqual([[700, 900]]);
    expect(await darkRuns(page, layer1.id, 'col', CX, 100, 300)).toEqual([[100, 300]]);
    expect(await darkRuns(page, layer1.id, 'row', 180, 700, 900)).toEqual([
      [718, 721], [758, 761], [798, 801], [838, 841], [878, 881],
    ]);
    expect(await darkRuns(page, layer1.id, 'col', 780, 100, 300)).toEqual([
      [118, 121], [158, 161], [198, 201], [238, 241], [278, 281],
    ]);

    await page.click('text=Filter');
    await page.click('text=Liquify...');
    const panel = page.locator('[data-testid="liquify-panel"]');
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    await panel.locator('select[aria-label="Liquify mode"]').selectOption('bloat');
    await panel.locator('input[aria-label="Brush size"]').fill('300');
    await panel.locator('input[aria-label="Brush pressure"]').fill('50');
    await expect(panel).toContainText('300');
    await expect(panel).toContainText('50%');

    // One dab: a dab fires on pointer move, at the move's position. Press
    // one screen pixel left of the crossing and nudge onto it, so the
    // single dab lands on (800, 200).
    const c = await docToScreen(page, CX, CY);
    await page.mouse.move(c.x - 1, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y);
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.locator('[data-testid="liquify-apply"]').click();
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-bloat-grid-after.png') });

    // The bloat did something: bars around the centre are pushed outward
    // (the 758 bar moves left, the 838 bar right; likewise vertically).
    const offRow = await darkRuns(page, layer1.id, 'row', 180, 700, 900);
    expect(offRow).toHaveLength(5);
    expect(offRow[1]![0]).toBeLessThan(752);
    expect(offRow[3]![1]).toBeGreaterThan(847);
    const offCol = await darkRuns(page, layer1.id, 'col', 780, 100, 300);
    expect(offCol).toHaveLength(5);
    expect(offCol[1]![0]).toBeLessThan(152);
    expect(offCol[3]![1]).toBeGreaterThan(247);

    // ...and the centre is magnified: the central bars get wider than 4px.
    const centreBar = offRow[2]!;
    expect(centreBar[0]).toBeLessThanOrEqual(798);
    expect(centreBar[1]).toBeGreaterThanOrEqual(801);
    expect(centreBar[1] - centreBar[0] + 1).toBeGreaterThan(4);

    // Continuity: the horizontal bar still runs unbroken through the centre
    // row, and the vertical bar through the centre column.
    expect(await darkRuns(page, layer1.id, 'row', CY, 700, 900)).toEqual([[700, 900]]);
    expect(await darkRuns(page, layer1.id, 'col', CX, 100, 300)).toEqual([[100, 300]]);

    // #945: a constant-length displacement doesn't vanish at the centre, so
    // pixels near it sampled from the far side and the image folded — the
    // crossing turned into a black star with a white hole. With the fix the
    // whole crossing square stays dark...
    for (let y = 198; y < 202; y++) {
      for (let x = 798; x < 802; x++) {
        const runs = await darkRuns(page, layer1.id, 'row', y, x, x);
        expect(runs, `crossing pixel (${x}, ${y}) should be dark`).toEqual([[x, x]]);
      }
    }
    // ...and the diagonals just outside it stay white (no star arms).
    for (const [dx, dy] of [[-7, -7], [6, -7], [-7, 6], [6, 6]] as const) {
      const x = CX + dx;
      const y = CY + dy;
      const runs = await darkRuns(page, layer1.id, 'row', y, x, x);
      expect(runs, `diagonal pixel (${x}, ${y}) should be white`).toEqual([]);
    }
  });
});
