import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, addLayer, getEditorState } from './helpers';

// Layers panel edge auto-scroll during a grip drag. A long layer list
// scrolls inside the panel; dragging a row near the list's top or bottom
// edge must scroll it so the row can be dropped on a target that started
// out of view. Before the fix the list never moved during a drag, so a
// row could only be dropped on targets already visible.

const LIST = '[data-testid="layer-list"]';

/** Panel rows top→bottom, as layer ids in DOM order. */
async function panelIds(page: Page): Promise<string[]> {
  return page.locator('[data-layer-id]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-layer-id') ?? ''),
  );
}

async function listScroll(page: Page): Promise<{ top: number; max: number }> {
  return page.locator(LIST).evaluate((el) => ({
    top: el.scrollTop,
    max: el.scrollHeight - el.clientHeight,
  }));
}

async function lastHistoryLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    const stack = store.getState().undoStack;
    return stack[stack.length - 1]?.label ?? null;
  });
}

async function parentOf(page: Page, id: string): Promise<string | null> {
  const state = await getEditorState(page);
  const layers = state.document.layers as unknown as Array<{ id: string; type: string; children?: string[] }>;
  return layers.find((l) => l.type === 'group' && l.children?.includes(id))?.id ?? null;
}

async function activeLayerId(page: Page): Promise<string> {
  return (await getEditorState(page)).document.activeLayerId as string;
}

/** Scroll the layer list to its bottom with the mouse wheel. */
async function wheelListToBottom(page: Page): Promise<void> {
  const box = (await page.locator(LIST).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(30);
    const { top, max } = await listScroll(page);
    if (top >= max - 1) return;
  }
}

test.describe('Layers panel auto-scrolls while dragging a row', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
    for (let i = 0; i < 30; i++) await addLayer(page);
  });

  test('the bottom row can be dragged to the top of a scrolled list', async ({ page }) => {
    const { max } = await listScroll(page);
    // The list must overflow by several rows for this test to mean anything.
    expect(max).toBeGreaterThan(36 * 5);

    await wheelListToBottom(page);
    expect((await listScroll(page)).top).toBeGreaterThanOrEqual(max - 1);

    const before = await panelIds(page);
    const root = before[0]!;
    const topLayer = before[1]!;
    const dragged = before[before.length - 1]!;

    // The top layer row starts out of view.
    const listBox = (await page.locator(LIST).boundingBox())!;
    const topBoxBefore = (await page.locator(`[data-layer-id="${topLayer}"]`).boundingBox())!;
    expect(topBoxBefore.y + topBoxBefore.height).toBeLessThan(listBox.y);

    const grip = page.locator(`[data-layer-id="${dragged}"] [aria-label^="Drag to reorder"]`);
    const gripBox = (await grip.boundingBox())!;
    const x = gripBox.x + gripBox.width / 2;
    await page.mouse.move(x, gripBox.y + gripBox.height / 2);
    await page.mouse.down();

    // Hover just inside the list's top edge: the list scrolls up on its own.
    // The step is per animation frame and the scroll spans ~30 rows; on a
    // loaded swiftshader runner rAF drops well below 60fps, so allow time.
    await page.mouse.move(x, listBox.y + 4, { steps: 10 });
    await expect.poll(async () => (await listScroll(page)).top, { timeout: 20000 }).toBe(0);

    // The top layer row is now on screen; drop in the gap above it.
    const topBox = (await page.locator(`[data-layer-id="${topLayer}"]`).boundingBox())!;
    expect(topBox.y).toBeGreaterThanOrEqual(listBox.y);
    await page.mouse.move(x, topBox.y + topBox.height * 0.2, { steps: 4 });
    await page.waitForTimeout(100);
    await expect(page.locator(`[data-layer-id="${topLayer}"][data-drop-depth="1"]`)).toHaveCount(1);
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/layer-dnd-autoscroll-bottom-to-top.png' });

    const after = await panelIds(page);
    expect(after.slice(0, 3)).toEqual([root, dragged, topLayer]);
    expect(after).toHaveLength(before.length);
    expect(await lastHistoryLabel(page)).toBe('Reorder Layer');
  });

  test('scrolling follows the pointer zone and stops when the drag ends', async ({ page }) => {
    const before = await panelIds(page);
    const listBox = (await page.locator(LIST).boundingBox())!;
    const dragged = before[1]!;
    const grip = page.locator(`[data-layer-id="${dragged}"] [aria-label^="Drag to reorder"]`);
    const gripBox = (await grip.boundingBox())!;
    const x = gripBox.x + gripBox.width / 2;
    expect((await listScroll(page)).top).toBe(0);
    const initiallyVisible = await page.locator('[data-layer-id]').evaluateAll(
      (els, bottom) => els.filter((el) => el.getBoundingClientRect().bottom <= bottom).length,
      listBox.y + listBox.height,
    );

    await page.mouse.move(x, gripBox.y + gripBox.height / 2);
    await page.mouse.down();

    // Pointer past the bottom edge (over the toolbar) keeps scrolling down.
    await page.mouse.move(x, listBox.y + listBox.height + 10, { steps: 10 });
    await expect.poll(async () => (await listScroll(page)).top, { timeout: 5000 }).toBeGreaterThan(36);

    // Back in the middle of the list: scrolling stops.
    await page.mouse.move(x, listBox.y + listBox.height / 2, { steps: 4 });
    await page.waitForTimeout(100);
    const parked = (await listScroll(page)).top;
    await page.waitForTimeout(400);
    expect((await listScroll(page)).top).toBe(parked);

    // Into the bottom zone again, then release: no scrolling after pointer-up.
    await page.mouse.move(x, listBox.y + listBox.height - 4, { steps: 4 });
    await expect.poll(async () => (await listScroll(page)).top, { timeout: 5000 }).toBeGreaterThan(parked);
    await page.mouse.up();
    // The drop itself can shift scrollTop once (scroll anchoring as the
    // dragged row leaves the rows above the viewport); after that it holds.
    await page.waitForTimeout(100);
    const released = (await listScroll(page)).top;
    await page.waitForTimeout(400);
    expect((await listScroll(page)).top).toBe(released);

    // The drop landed on a row that was hidden when the drag started.
    const after = await panelIds(page);
    expect(after.indexOf(dragged)).toBeGreaterThan(initiallyVisible);
    expect(await lastHistoryLabel(page)).toBe('Reorder Layer');
  });
});

test.describe('Layers panel auto-scroll into a group gap', () => {
  test('a row dragged up from the bottom can land at the bottom of an expanded group', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);

    const layer1 = (await panelIds(page))[1]!;
    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const group = await activeLayerId(page);
    const a = await addLayer(page);
    const b = await addLayer(page);
    expect(await parentOf(page, a)).toBe(group);
    expect(await parentOf(page, b)).toBe(group);

    await page.locator(`[data-layer-id="${layer1}"]`).click();
    await page.waitForTimeout(100);
    for (let i = 0; i < 25; i++) await addLayer(page);

    const before = await panelIds(page);
    const root = before[0]!;
    expect(before.slice(1, 4)).toEqual([group, b, a]);
    const belowGroup = before[4]!;
    const dragged = before[before.length - 1]!;
    expect(await parentOf(page, dragged)).toBe(root);

    await wheelListToBottom(page);
    const listBox = (await page.locator(LIST).boundingBox())!;
    const grip = page.locator(`[data-layer-id="${dragged}"] [aria-label^="Drag to reorder"]`);
    const gripBox = (await grip.boundingBox())!;
    const x = gripBox.x + gripBox.width / 2;
    await page.mouse.move(x, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, listBox.y + 2, { steps: 10 });
    await expect.poll(async () => (await listScroll(page)).top, { timeout: 20000 }).toBe(0);

    // The gap under the group's last child, dragged one level to the right:
    // the bottom of the group, not below it.
    const targetBox = (await page.locator(`[data-layer-id="${belowGroup}"]`).boundingBox())!;
    await page.mouse.move(x + 20, targetBox.y + targetBox.height * 0.2, { steps: 4 });
    await page.waitForTimeout(100);
    await expect(page.locator(`[data-layer-id="${belowGroup}"][data-drop-depth="2"]`)).toHaveCount(1);
    await page.mouse.up();
    await page.waitForTimeout(200);

    expect(await parentOf(page, dragged)).toBe(group);
    expect((await panelIds(page)).slice(0, 6)).toEqual([root, group, b, a, dragged, belowGroup]);
  });
});
