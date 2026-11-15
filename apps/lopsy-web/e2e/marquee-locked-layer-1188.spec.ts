import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen } from './helpers';

// #1188 — With a locked layer active, the canvas refused every press, so a
// marquee drawn after a Deselect made no selection and Copy Merged → Paste
// came out document-sized at 0,0. The lock guards pixels, not selections.

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

interface EditorSnapshot {
  activeLayerId: string;
  isActiveLocked: boolean;
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
  isSelectionActive: boolean;
  activeBox: { name: string; x: number; y: number; width: number; height: number } | null;
  undoCount: number;
}

async function snapshot(page: Page): Promise<EditorSnapshot> {
  return page.evaluate(() => {
    interface L { id: string; name: string; locked: boolean; x: number; y: number; width: number; height: number }
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: L[] };
        selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
        undoStack: unknown[];
      };
    };
    const s = store.getState();
    const l = s.document.layers.find((x) => x.id === s.document.activeLayerId);
    return {
      activeLayerId: s.document.activeLayerId,
      isActiveLocked: !!l?.locked,
      selectionBounds: s.selection.bounds ? { ...s.selection.bounds } : null,
      isSelectionActive: s.selection.active,
      activeBox: l ? { name: l.name, x: l.x, y: l.y, width: l.width, height: l.height } : null,
      undoCount: s.undoStack.length,
    };
  });
}

test.describe('Selection tools work on a locked layer (#1188)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('a marquee over a locked layer selects, and Copy Merged copies only that', async ({ page }) => {
    const { activeLayerId } = await snapshot(page);
    await page.locator(`[data-layer-id="${activeLayerId}"] [aria-label="Lock layer"]`).click();
    await page.waitForTimeout(120);
    expect((await snapshot(page)).isActiveLocked).toBe(true);

    await page.locator('[data-tool-id="marquee-rect"]').click();
    await page.waitForTimeout(120);
    await drag(page, 60, 40, 260, 190);

    const afterMarquee = await snapshot(page);
    expect(afterMarquee.isSelectionActive).toBe(true);
    expect(afterMarquee.selectionBounds).toEqual({ x: 60, y: 40, width: 200, height: 150 });

    await menu(page, 'Edit', /^Copy Merged$/);
    await menu(page, 'Edit', /^Paste$/);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/marquee-locked-layer-paste.png' });

    const pasted = (await snapshot(page)).activeBox;
    expect(pasted?.name).toBe('Pasted Layer');
    expect(pasted).toMatchObject({ x: 60, y: 40, width: 200, height: 150 });
  });

  test('the lock still refuses a brush stroke', async ({ page }) => {
    const { activeLayerId } = await snapshot(page);
    await page.locator(`[data-layer-id="${activeLayerId}"] [aria-label="Lock layer"]`).click();
    await page.waitForTimeout(120);
    const before = (await snapshot(page)).undoCount;

    await page.keyboard.press('b');
    await page.waitForTimeout(120);
    await drag(page, 60, 60, 300, 200);

    expect((await snapshot(page)).undoCount).toBe(before);
  });
});
