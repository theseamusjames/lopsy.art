import { test, expect, type Page } from './fixtures';
import { createDocument, getEditorState, setToolOption, waitForStore } from './helpers';
import { clickAtDoc, getTextEditing, selectTextTool } from './text-edit-helpers';

/** Ink extent of one line of a text layer, in document pixels. */
interface LineInk {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Split a text layer's GPU texture into its lines (runs of rows holding ink,
 * separated by empty rows) and return each line's ink extent in document
 * space. Caps-only text keeps descenders from bridging the line gap.
 */
async function lineInk(page: Page, layerId: string): Promise<LineInk[]> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      layerId?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const editor = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = editor.getState().document.layers.find((l) => l.id === id)!;
    const { width, height, pixels } = await read(id);
    const lines: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    let current: { left: number; right: number; top: number; bottom: number } | null = null;
    for (let y = 0; y < height; y++) {
      let left = -1;
      let right = -1;
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 128) {
          if (left < 0) left = x;
          right = x;
        }
      }
      if (left < 0) {
        if (current) lines.push(current);
        current = null;
        continue;
      }
      if (!current) current = { left, right, top: y, bottom: y };
      current.left = Math.min(current.left, left);
      current.right = Math.max(current.right, right);
      current.bottom = y;
    }
    if (current) lines.push(current);
    return lines.map((l) => ({
      left: layer.x + l.left,
      right: layer.x + l.right + 1,
      top: layer.y + l.top,
      bottom: layer.y + l.bottom + 1,
    }));
  }, layerId);
}

const centre = (l: LineInk) => (l.left + l.right) / 2;

async function textLayerId(page: Page): Promise<string> {
  const layer = (await getEditorState(page)).document.layers.find((l) => l.type === 'text');
  expect(layer).toBeDefined();
  return layer!.id;
}

async function pickOptionsBarAlign(page: Page, align: 'left' | 'center' | 'right'): Promise<void> {
  await page.locator('select[aria-labelledby="text-align-label"]').selectOption(align);
  await page.waitForTimeout(150);
}

/** Type a wide line over a narrow one; caps only so the lines' ink never touches. */
async function typeTwoLines(page: Page): Promise<void> {
  await page.keyboard.type('WIDE FIRST LINE');
  await page.keyboard.press('Enter');
  await page.keyboard.type('MID');
  await page.waitForTimeout(150);
}

async function commit(page: Page): Promise<void> {
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(200);
}

test.describe('Point text alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 700, 300);
    await selectTextTool(page);
    await setToolOption(page, 'Size', 40);
  });

  test('Center centres every line on the click point', async ({ page }) => {
    await pickOptionsBarAlign(page, 'center');
    await clickAtDoc(page, 350, 80);
    await typeTwoLines(page);
    await commit(page);
    await page.screenshot({ path: 'e2e/screenshots/point-text-align-center.png' });

    const lines = await lineInk(page, await textLayerId(page));
    expect(lines).toHaveLength(2);
    // The wide line is far wider than "MID", yet both share one centre…
    expect(lines[0]!.right - lines[0]!.left).toBeGreaterThan((lines[1]!.right - lines[1]!.left) * 3);
    expect(Math.abs(centre(lines[0]!) - centre(lines[1]!))).toBeLessThanOrEqual(3);
    // …and that centre is where the user clicked.
    expect(Math.abs(centre(lines[0]!) - 350)).toBeLessThanOrEqual(4);
    expect(Math.abs(centre(lines[1]!) - 350)).toBeLessThanOrEqual(4);
  });

  test('Right ends every line at the click point', async ({ page }) => {
    await pickOptionsBarAlign(page, 'right');
    await clickAtDoc(page, 500, 80);
    await typeTwoLines(page);
    await commit(page);
    await page.screenshot({ path: 'e2e/screenshots/point-text-align-right.png' });

    const lines = await lineInk(page, await textLayerId(page));
    expect(lines).toHaveLength(2);
    expect(Math.abs(lines[0]!.right - lines[1]!.right)).toBeLessThanOrEqual(4);
    expect(Math.abs(lines[0]!.right - 500)).toBeLessThanOrEqual(5);
    // The short line hangs off the right edge, well clear of the left one.
    expect(lines[1]!.left - lines[0]!.left).toBeGreaterThan(100);
  });

  test('re-aligning a committed layer realigns its lines without moving the block', async ({ page }) => {
    await clickAtDoc(page, 120, 80);
    await typeTwoLines(page);
    await commit(page);
    const layerId = await textLayerId(page);

    const before = await lineInk(page, layerId);
    expect(before).toHaveLength(2);
    expect(Math.abs(before[0]!.left - before[1]!.left)).toBeLessThanOrEqual(4); // flush left

    await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
    await page.locator('button[aria-label="Align center"]').click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'e2e/screenshots/point-text-align-recentred.png' });

    const after = await lineInk(page, layerId);
    expect(after).toHaveLength(2);
    // The wide line stays exactly where it was…
    expect(Math.abs(after[0]!.left - before[0]!.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(after[0]!.right - before[0]!.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(after[0]!.top - before[0]!.top)).toBeLessThanOrEqual(1);
    // …and the short one moves under its centre.
    expect(Math.abs(centre(after[0]!) - centre(after[1]!))).toBeLessThanOrEqual(3);
    expect(after[1]!.left - before[1]!.left).toBeGreaterThan(100);
  });

  test('re-aligning while typing keeps the block in place and clicks follow the moved line', async ({ page }) => {
    await clickAtDoc(page, 120, 80);
    await typeTwoLines(page);
    const layerId = (await getTextEditing(page))!.layerId;
    const before = await lineInk(page, layerId);
    expect(before).toHaveLength(2);

    await pickOptionsBarAlign(page, 'center');
    expect(await getTextEditing(page)).not.toBeNull();
    const after = await lineInk(page, layerId);
    expect(after).toHaveLength(2);
    expect(Math.abs(after[0]!.left - before[0]!.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre(after[0]!) - centre(after[1]!))).toBeLessThanOrEqual(3);

    // Click just inside the left edge of the re-centred "MID": the caret must
    // land before its "M" — where the line now is, not where it used to be.
    const midY = (after[1]!.top + after[1]!.bottom) / 2;
    await clickAtDoc(page, after[1]!.left + 3, midY);
    const editing = (await getTextEditing(page))!;
    expect(editing.text).toBe('WIDE FIRST LINE\nMID');
    expect(editing.cursorPos).toBe('WIDE FIRST LINE\n'.length);

    await page.keyboard.type('X');
    await commit(page);
    const layer = (await getEditorState(page)).document.layers.find((l) => l.id === layerId) as
      { text?: string; textAlign?: string } | undefined;
    expect(layer?.text).toBe('WIDE FIRST LINE\nXMID');
    expect(layer?.textAlign).toBe('center');
  });
});
