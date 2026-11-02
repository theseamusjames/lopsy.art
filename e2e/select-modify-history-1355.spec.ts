import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, setForegroundColor } from './helpers';

// #1355 — Select → Grow / Shrink / Feather pushed no history entry, so ⌘Z
// right after one undid the edit before it (a Fill) instead.

async function dragOnCanvas(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

async function modifySelection(page: Page, item: 'Grow' | 'Shrink' | 'Feather', amount: number): Promise<void> {
  await menu(page, 'Select', new RegExp(`^${item}`));
  const modal = page.locator(`[role="dialog"][aria-label="${item} Selection"]`);
  await modal.waitFor({ state: 'visible' });
  const input = modal.locator('input[aria-label$=" value"]').first();
  await input.fill(String(amount));
  await input.press('Tab');
  await modal.getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(300);
}

interface SelectionProbe {
  bounds: { x: number; y: number; width: number; height: number } | null;
  labels: string[];
}

async function probeSelection(page: Page): Promise<SelectionProbe> {
  return page.evaluate(() => {
    const store = (window as unknown as {
      __editorStore: { getState: () => {
        selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
        undoStack: { label: string }[];
      } };
    }).__editorStore.getState();
    return {
      bounds: store.selection.active ? store.selection.bounds : null,
      labels: store.undoStack.map((s) => s.label),
    };
  });
}

async function compositeAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
    const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
    const i = ((p.height - 1 - sy) * p.width + sx) * 4;
    return [p.pixels[i] ?? 0, p.pixels[i + 1] ?? 0, p.pixels[i + 2] ?? 0] as [number, number, number];
  }, { x, y });
}

test.describe('Select → Grow / Shrink / Feather history (#1355)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  const cases = [
    { item: 'Grow', label: 'Grow Selection', amount: 20, grownBounds: { x: 80, y: 80, width: 240, height: 190 } },
    { item: 'Shrink', label: 'Shrink Selection', amount: 20, grownBounds: { x: 120, y: 120, width: 160, height: 110 } },
    { item: 'Feather', label: 'Feather Selection', amount: 20, grownBounds: null },
  ] as const;

  for (const c of cases) {
    test(`⌘Z after ${c.item} undoes only the ${c.item.toLowerCase()}, keeping the Fill`, async ({ page }) => {
      await page.keyboard.press('m');
      await dragOnCanvas(page, 100, 100, 300, 250);
      await setForegroundColor(page, 224, 32, 32);
      await menu(page, 'Edit', /^Fill$/);

      const filled = await probeSelection(page);
      expect(filled.bounds).toEqual({ x: 100, y: 100, width: 200, height: 150 });
      expect(filled.labels.at(-1)).toBe('Fill');

      await modifySelection(page, c.item, c.amount);
      const modified = await probeSelection(page);
      expect(modified.labels.at(-1)).toBe(c.label);
      expect(modified.bounds).not.toEqual(filled.bounds);
      if (c.grownBounds) expect(modified.bounds).toEqual(c.grownBounds);

      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/screenshots/select-${c.item.toLowerCase()}-undo.png` });

      const undone = await probeSelection(page);
      expect(undone.bounds).toEqual({ x: 100, y: 100, width: 200, height: 150 });
      expect(undone.labels.at(-1)).toBe('Fill');
      // The fill is still on the canvas at the box centre; outside stays white.
      const [r, g, b] = await compositeAt(page, 200, 175);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
      const outside = await compositeAt(page, 30, 30);
      expect(outside.every((v) => v >= 250)).toBe(true);

      await page.keyboard.press('Control+Shift+z');
      await page.waitForTimeout(300);
      const redone = await probeSelection(page);
      expect(redone.bounds).toEqual(modified.bounds);
    });
  }
});
