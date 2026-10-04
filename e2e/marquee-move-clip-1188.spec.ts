import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen } from './helpers';

// #1188 — Moving a selection outline with the marquee kept the old bounds
// shifted as a whole, so after moving a Select All right/down the bounds hung
// off the canvas at full document size and Copy Merged → Paste produced a
// document-sized layer instead of the part still on the canvas.

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const s = await docToScreen(page, x0, y0);
  const e = await docToScreen(page, x1, y1);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

interface LayerBox {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function activeLayerBox(page: Page): Promise<LayerBox | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: LayerBox[] & Array<{ id: string }> };
      };
    };
    const { document: doc } = store.getState();
    const l = doc.layers.find((x) => x.id === doc.activeLayerId);
    return l ? { name: l.name, x: l.x, y: l.y, width: l.width, height: l.height } : null;
  });
}

test.describe('Marquee move clips the selection to the canvas (#1188)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('Select All moved right/down then Copy Merged → Paste gives the on-canvas overlap', async ({ page }) => {
    await page.locator('[data-tool-id="marquee-rect"]').click();
    await page.waitForTimeout(120);
    await menu(page, 'Select', /^All$/);

    // Drag inside the selection: moves the outline by (+150, +100).
    await drag(page, 100, 100, 250, 200);

    await menu(page, 'Edit', /^Copy Merged$/);
    await menu(page, 'Edit', /^Paste$/);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/marquee-move-clip-paste.png' });

    // The outline now covers (150,100)→(400,300): 250 × 200 on the canvas.
    const pasted = await activeLayerBox(page);
    expect(pasted?.name).toBe('Pasted Layer');
    expect(pasted).toMatchObject({ x: 150, y: 100, width: 250, height: 200 });
  });
});
