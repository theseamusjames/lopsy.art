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

const CX = 600;
const CY = 400;
const BRUSH = 220;
const HALF = BRUSH / 2;

type Orientation = 'vertical' | 'horizontal';

async function fillStripe(page: Page, orientation: Orientation, offset: number): Promise<void> {
  const [x0, y0, x1, y1] = orientation === 'vertical'
    ? [offset, CY - 200, offset + 20, CY + 200]
    : [CX - 200, offset, CX + 200, offset + 20];
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.keyboard.press('Control+d');
}

/** Dark-pixel mask of the doc-space square around the brush, row-major. */
async function darkMask(page: Page, layerId: string): Promise<boolean[][]> {
  return page.evaluate(
    async ({ lid, x0, y0, size }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
      };
      const layer = store.getState().document.layers.find((l) => l.id === lid);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const { width, height, pixels } = await readFn(lid);
      const rows: boolean[][] = [];
      for (let y = y0; y < y0 + size; y++) {
        const row: boolean[] = [];
        for (let x = x0; x < x0 + size; x++) {
          const px = x - lx;
          const py = y - ly;
          if (px < 0 || py < 0 || px >= width || py >= height) {
            row.push(false);
            continue;
          }
          const i = (py * width + px) * 4;
          row.push((pixels[i + 3] ?? 0) > 128 && (pixels[i] ?? 255) < 128);
        }
        rows.push(row);
      }
      return rows;
    },
    { lid: layerId, x0: CX - HALF, y0: CY - HALF, size: BRUSH },
  );
}

/** Fraction of pixels whose dark/light state differs between two lines. */
function mismatch(a: boolean[], b: boolean[]): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n / a.length;
}

function column(mask: boolean[][], x: number): boolean[] {
  return mask.map((row) => row[x]!);
}

/**
 * Lines parallel to the stripes, so neighbours only differ where the warp
 * moves content. Vertical stripes are read row by row, horizontal ones
 * column by column.
 */
function line(mask: boolean[][], orientation: Orientation, i: number): boolean[] {
  return orientation === 'vertical' ? mask[i]! : column(mask, i);
}

test.describe('Liquify Twirl keeps the field continuous (#1212)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'liquify panel not fully accessible on narrow viewport');
    await page.goto('/');
    await waitForStore(page);
  });

  // Vertical stripes show the seam along the horizontal line through the
  // centre (where the X offset crosses zero); horizontal stripes show the
  // one along the vertical line (where the Y offset does).
  for (const orientation of ['vertical', 'horizontal'] as const) {
  test(`circling Twirl CW over ${orientation} stripes leaves no seams through the brush centre`, async ({ page }) => {
    await createDocument(page, 1200, 800, false);
    const state = await getEditorState(page);
    const layer1 = state.document.layers.find((l) => l.name === 'Layer 1');
    if (!layer1) throw new Error('Layer 1 not found');

    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'marquee-rect');
    const centre = orientation === 'vertical' ? CX : CY;
    for (let o = centre - 180; o <= centre + 180; o += 40) {
      await fillStripe(page, orientation, o);
    }
    const before = await darkMask(page, layer1.id);

    await page.click('text=Filter');
    await page.click('text=Liquify...');
    const panel = page.locator('[data-testid="liquify-panel"]');
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    await panel.locator('select[aria-label="Liquify mode"]').selectOption('twirl-cw');
    await panel.locator('input[aria-label="Brush size"]').fill(String(BRUSH));
    await panel.locator('input[aria-label="Brush pressure"]').fill('70');
    await expect(panel).toContainText(`${BRUSH}`);
    await expect(panel).toContainText('70%');

    // Small loops around the centre, as in the report: every move is a dab.
    const c = await docToScreen(page, CX, CY);
    const r = await docToScreen(page, CX + 6, CY);
    const loop = r.x - c.x;
    await page.mouse.move(c.x + loop, c.y);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) {
      const a = (i / 8) * Math.PI * 2;
      await page.mouse.move(c.x + Math.cos(a) * loop, c.y + Math.sin(a) * loop);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.locator('[data-testid="liquify-apply"]').click();
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `liquify-twirl-seams-1212-${orientation}.png`) });

    const after = await darkMask(page, layer1.id);

    // The twirl did bend the stripes inside the brush.
    let changed = 0;
    for (let i = 0; i < BRUSH; i++) {
      changed += mismatch(line(before, orientation, i), line(after, orientation, i));
    }
    expect(changed / BRUSH).toBeGreaterThan(0.05);

    // A smooth swirl changes little from one line to the next. The seams in
    // #1212 sat on the lines through the centre, where stripes jumped
    // ~16 px sideways between neighbouring rows or columns.
    const steps: number[] = [];
    for (let i = 0; i < BRUSH - 1; i++) {
      steps.push(mismatch(line(after, orientation, i), line(after, orientation, i + 1)));
    }
    expect(Math.max(...steps)).toBeLessThan(0.1);
  });
  }
});
