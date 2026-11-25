/**
 * Characterization: the Path menu, item by item, as it behaves today.
 *
 * Each boolean item combines the selected path with the most recently added
 * other path, replaces both with the result and pushes one metadata entry.
 * No item is ever aria-disabled; when the operation cannot run (fewer than
 * two paths, no selected path, or an empty result) the click does nothing.
 *
 * Paths are made through the UI with a marquee plus Select > Selection → Path:
 * A = rect x 20..100, y 20..100, then B = rect x 60..140, y 40..120. Selection
 * → Path selects the path it adds, so B is the selected path.
 */
import { test, expect, type Page } from './fixtures';
import {
  clickMenu,
  dragMarquee,
  historyLabels,
  isMenuItemDisabled,
  menuItem,
  closeMenus,
  openDialogName,
  openDocument,
  surfaceState,
  toasts,
} from './surface-helpers';
import { pathSummaries, showPathsPanel } from './surface-helpers-filters';

const ITEMS = ['Unite Paths', 'Subtract Paths', 'Intersect Paths', 'Exclude Paths'] as const;
type PathItem = (typeof ITEMS)[number];

async function selectionToPath(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await dragMarquee(page, x0, y0, x1, y1);
  await clickMenu(page, 'Select', 'Selection → Path');
  await page.keyboard.press('Control+d');
}

async function twoOverlappingPaths(page: Page): Promise<{ a: string; b: string }> {
  await selectionToPath(page, 20, 20, 100, 100);
  await selectionToPath(page, 60, 40, 140, 120);
  const { paths, selectedPathId } = await pathSummaries(page);
  expect(paths.map((p) => p.bounds)).toEqual([
    { minX: 20, minY: 20, maxX: 100, maxY: 100 },
    { minX: 60, minY: 40, maxX: 140, maxY: 120 },
  ]);
  expect(selectedPathId).toBe(paths[1]!.id);
  expect(await historyLabels(page)).toEqual(['New Document', 'Selection to Path', 'Selection to Path']);
  return { a: paths[0]!.id, b: paths[1]!.id };
}

/** Click Path > item and check it changed nothing at all. */
async function expectNoOp(page: Page, item: PathItem): Promise<void> {
  const before = await pathSummaries(page);
  const history = await historyLabels(page);
  await clickMenu(page, 'Path', item);
  expect(await pathSummaries(page)).toEqual(before);
  expect(await historyLabels(page)).toEqual(history);
  expect(await toasts(page)).toEqual([]);
  expect(await openDialogName(page)).toBeNull();
}

test.describe('Path menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  test('lists the four boolean items, none aria-disabled even with no paths', async ({ page }) => {
    await menuItem(page, 'Path', 'Unite Paths');
    const items = page.locator('[role="menu"][aria-label="Path"]').getByRole('menuitem');
    await expect(items).toHaveText([...ITEMS]);
    await closeMenus(page);
    for (const item of ITEMS) expect(await isMenuItemDisabled(page, 'Path', item)).toBe(false);
  });

  for (const item of ITEMS) {
    test(`${item} with no paths, or one path, does nothing`, async ({ page }) => {
      expect((await surfaceState(page)).pathCount).toBe(0);
      await expectNoOp(page, item);

      await selectionToPath(page, 20, 20, 100, 100);
      expect((await pathSummaries(page)).selectedPathId).not.toBeNull();
      await expectNoOp(page, item);
      expect((await surfaceState(page)).pathCount).toBe(1);
    });

    test(`${item} with two paths but none selected does nothing`, async ({ page }) => {
      const { b } = await twoOverlappingPaths(page);
      const list = await showPathsPanel(page);
      // A click on the selected row toggles the selection off.
      await list.locator(`[data-testid="path-item-${b}"]`).click();
      await expect(list.locator(`[data-testid="path-item-${b}"]`)).toHaveAttribute('aria-selected', 'false');
      expect((await pathSummaries(page)).selectedPathId).toBeNull();
      expect(await isMenuItemDisabled(page, 'Path', item)).toBe(false);

      await expectNoOp(page, item);
    });
  }

  const results: Record<PathItem, { label: string; bounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }> }> = {
    'Unite Paths': { label: 'Unite Paths', bounds: [{ minX: 20, minY: 20, maxX: 140, maxY: 120 }] },
    // B (selected) minus A.
    'Subtract Paths': { label: 'Subtract Paths', bounds: [{ minX: 60, minY: 40, maxX: 140, maxY: 120 }] },
    'Intersect Paths': { label: 'Intersect Paths', bounds: [{ minX: 60, minY: 40, maxX: 100, maxY: 100 }] },
    'Exclude Paths': { label: 'Exclude Paths', bounds: [] },
  };

  for (const item of ITEMS) {
    test(`${item} replaces both paths with the result and pushes "${results[item].label}"`, async ({ page }) => {
      const { a, b } = await twoOverlappingPaths(page);

      await clickMenu(page, 'Path', item);

      const { paths, selectedPathId } = await pathSummaries(page);
      expect(await historyLabels(page)).toEqual(['New Document', 'Selection to Path', 'Selection to Path', results[item].label]);
      expect(paths.some((p) => p.id === a || p.id === b)).toBe(false);
      expect(paths.every((p) => p.closed)).toBe(true);
      // addPath selects each new path, so the last result is selected.
      expect(selectedPathId).toBe(paths.at(-1)!.id);
      if (item === 'Exclude Paths') {
        // XOR leaves two islands: A − B and B − A, one path each.
        expect(paths.map((p) => p.bounds)).toEqual([
          { minX: 20, minY: 20, maxX: 100, maxY: 100 },
          { minX: 60, minY: 40, maxX: 140, maxY: 120 },
        ]);
      } else {
        expect(paths.map((p) => p.bounds)).toEqual(results[item].bounds);
      }
      expect(await toasts(page)).toEqual([]);

      await page.keyboard.press('Control+z');
      const undone = await pathSummaries(page);
      expect(undone.paths.map((p) => p.id)).toEqual([a, b]);
    });
  }

  test('Intersect Paths on two paths that do not overlap does nothing', async ({ page }) => {
    await selectionToPath(page, 10, 10, 50, 50);
    await selectionToPath(page, 120, 80, 180, 140);
    await expectNoOp(page, 'Intersect Paths');
    expect((await surfaceState(page)).pathCount).toBe(2);
  });
});
