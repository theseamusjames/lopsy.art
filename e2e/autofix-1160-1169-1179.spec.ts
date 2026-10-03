/**
 * #1179 — Delete Path records a history entry, so ⌘Z brings the path back
 *         instead of undoing the edit before it.
 * #1169 — the Gradient tool lines up with the drag on a layer moved to a
 *         negative offset (the shader compared texture-local positions with
 *         document-space endpoints).
 * #1160 — Mesh Warp moves content by the dragged distance instead of
 *         snapping to steps of docSize / 127.
 */
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  docToScreen,
  getEditorState,
  getPixelAt,
  selectTool,
  setForegroundColor,
  waitForStore,
} from './helpers';

const SHOTS = 'e2e/screenshots';

async function dragDoc(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
}

async function activeLayerId(page: Page): Promise<string> {
  return (await getEditorState(page)).document.activeLayerId;
}

async function layerPos(page: Page, id: string): Promise<{ x: number; y: number }> {
  const layer = (await getEditorState(page)).document.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`layer ${id} missing`);
  return { x: layer.x, y: layer.y };
}

/** Marquee a doc-space rect and bucket-fill it with the foreground colour. */
async function fillRect(page: Page, x: number, y: number, w: number, h: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, { x, y }, { x: x + w, y: y + h }, 5);
  await selectTool(page, 'fill');
  await clickDoc(page, x + w / 2, y + h / 2);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// #1179 — Delete Path history
// ---------------------------------------------------------------------------

async function showPathsPanel(page: Page) {
  const list = page.locator('[role="listbox"][aria-label="Paths"]');
  if (!(await list.isVisible().catch(() => false))) {
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
  }
  await expect(list).toBeVisible();
  return list;
}

async function drawClosedPenPath(page: Page): Promise<void> {
  await selectTool(page, 'path');
  await clickDoc(page, 500, 100);
  await clickDoc(page, 700, 100);
  await clickDoc(page, 600, 250);
  await clickDoc(page, 500, 100);
  await page.waitForTimeout(150);
}

async function brushStroke(page: Page): Promise<void> {
  await selectTool(page, 'brush');
  await dragDoc(page, { x: 100, y: 400 }, { x: 300, y: 400 }, 12);
}

async function deleteSelectedPathViaPanel(page: Page): Promise<void> {
  const list = await showPathsPanel(page);
  const row = list.locator('[role="option"]').first();
  if ((await row.getAttribute('aria-selected')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await page.locator('button[aria-label="Delete Path"]').click();
  await expect(list.locator('[role="option"]')).toHaveCount(0);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label?: string }> };
    };
    return store.getState().undoStack.map((s) => s.label ?? '');
  });
}

test.describe('#1179 Delete Path is undoable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('brush, pen path, delete path, undo: the path comes back', async ({ page }) => {
    await brushStroke(page);
    await drawClosedPenPath(page);
    expect((await historyLabels(page)).at(-1)).toBe('Add Path');

    await deleteSelectedPathViaPanel(page);
    expect((await historyLabels(page)).at(-1)).toBe('Delete Path');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/delete-path-undo-restores-path.png` });

    const list = await showPathsPanel(page);
    await expect(list.locator('[role="option"]')).toHaveCount(1);
    await expect(list.locator('[role="option"]').first()).toContainText('Path');
  });

  test('pen path, brush, delete path, undo: the path returns and the stroke stays', async ({ page }) => {
    await drawClosedPenPath(page);
    const strokeLayer = await activeLayerId(page);
    await brushStroke(page);

    await deleteSelectedPathViaPanel(page);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/delete-path-undo-keeps-stroke.png` });

    const list = await showPathsPanel(page);
    await expect(list.locator('[role="option"]')).toHaveCount(1);

    // The brush stroke (default black, painted along y = 400 from x = 100 to
    // 300) is still on the layer; before the fix ⌘Z undid it instead.
    const onStroke = await getPixelAt(page, 200, 400, strokeLayer);
    expect(onStroke.a).toBeGreaterThan(200);
    expect(onStroke.r).toBeLessThan(60);
    const offStroke = await getPixelAt(page, 200, 300, strokeLayer);
    expect(offStroke.a).toBe(0);
  });
});
