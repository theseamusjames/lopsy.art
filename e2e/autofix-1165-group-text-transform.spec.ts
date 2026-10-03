/**
 * #1165 — text turned by a multi-layer or group transform keeps its rotation.
 *
 * The Move tool's shared box (several layers, or a group, selected in the
 * Layers panel) used to rotate a text layer's pixels only: the layer stayed
 * `type: 'text'` with no stored transform, so its next re-render (here a Text
 * panel Letter spacing change) laid the glyphs out upright again at a shifted
 * position. The box now stores the transform on each text layer it moves, as
 * the single-layer text handles do (#1117).
 *
 * Every check reads the text layer's own pixels: the principal axis of its
 * ink (second moments) is ~0° for upright text and follows the rotation
 * otherwise, and the ink's centroid shows whether it stayed in place.
 */
import { readFileSync } from 'fs';
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  docToScreen,
  getEditorState,
  selectTool,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';
import { findTransformHandle } from './text-edit-helpers';

interface InkShape {
  count: number;
  cx: number;
  cy: number;
  /** Principal-axis angle in degrees, (−90, 90], clockwise on screen. */
  angle: number;
}

interface LayerRow {
  id: string;
  type: string;
  children?: string[];
}

const RECT = { x0: 200, y0: 200, x1: 600, y1: 400 };
const CENTRE = { x: (RECT.x0 + RECT.x1) / 2, y: (RECT.y0 + RECT.y1) / 2 };

async function layerRows(page: Page): Promise<LayerRow[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: LayerRow[] } };
    };
    return store.getState().document.layers.map((l) => ({ id: l.id, type: l.type, children: l.children }));
  });
}

async function activeLayerId(page: Page): Promise<string> {
  return (await getEditorState(page)).document.activeLayerId;
}

/** Shape of a layer's opaque pixels in document space. */
async function inkShape(page: Page, layerId: string): Promise<InkShape> {
  return page.evaluate(async (id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      layerId: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(id);
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) <= 128) continue;
        const dx = x + layer.x;
        const dy = y + layer.y;
        n++; sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
      }
    }
    const cx = sx / n;
    const cy = sy / n;
    const vxx = sxx / n - cx * cx;
    const vyy = syy / n - cy * cy;
    const vxy = sxy / n - cx * cy;
    const angle = (0.5 * Math.atan2(2 * vxy, vxx - vyy) * 180) / Math.PI;
    return { count: n, cx, cy, angle };
  }, layerId);
}

async function fillRect(page: Page, rgb: [number, number, number]): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, RECT.x0, RECT.y0);
  const end = await docToScreen(page, RECT.x1, RECT.y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await setForegroundColor(page, ...rgb);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

/** Type `TILT ME` at size 80 inside the rectangle and commit it with Tab. */
async function typeTiltMe(page: Page): Promise<string> {
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'text');
  await setToolOption(page, 'Size', 80);
  const at = await docToScreen(page, 230, 260);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
  await page.keyboard.type('TILT ME');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const text = (await layerRows(page)).find((l) => l.type === 'text');
  expect(text).toBeDefined();
  return text!.id;
}

async function clickRow(page: Page, layerId: string, modifiers: Array<'Shift'> = []): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"] span[class*="name"]`).first().click({ modifiers });
  await page.waitForTimeout(100);
}

/**
 * Turn the Move tool's shared box 15° clockwise with its top-right rotate
 * handle (⌘ snaps it to exactly 15°), then Escape to bake it. `corner` is
 * the box's top-right corner; the box is centred on the rectangle's centre.
 */
async function rotateBox15(page: Page, corner = { x: RECT.x1, y: RECT.y0 }): Promise<void> {
  await selectTool(page, 'move');
  const handle = await findTransformHandle(page, 'rotate-top-right', { x: corner.x + 14, y: corner.y - 14 }, 30);
  const pivot = await docToScreen(page, CENTRE.x, CENTRE.y);
  const radius = Math.hypot(handle.x - pivot.x, handle.y - pivot.y);
  const from = Math.atan2(handle.y - pivot.y, handle.x - pivot.x);
  await page.keyboard.down('Meta');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    const a = from + ((15 * Math.PI) / 180) * (i / 8);
    await page.mouse.move(pivot.x + radius * Math.cos(a), pivot.y + radius * Math.sin(a));
  }
  await page.mouse.up();
  await page.keyboard.up('Meta');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

async function setLetterSpacing(page: Page, value: number): Promise<void> {
  const input = page.locator('[aria-label="Letter spacing value"]').first();
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
    await expect(input).toBeVisible();
  }
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(300);
}

/** Where a point lands after the box's 15° clockwise turn about its centre. */
function turned(p: { x: number; y: number }, degrees = 15): { x: number; y: number } {
  const t = (degrees * Math.PI) / 180;
  const dx = p.x - CENTRE.x;
  const dy = p.y - CENTRE.y;
  return { x: CENTRE.x + dx * Math.cos(t) - dy * Math.sin(t), y: CENTRE.y + dx * Math.sin(t) + dy * Math.cos(t) };
}

/**
 * Rotate the selection's box, then change the text's letter spacing, and
 * check the text is still turned 15° where the box put it — both before and
 * after the re-render, and across undo / redo.
 */
async function expectTextKeepsBoxRotation(page: Page, textId: string, label: string): Promise<void> {
  const upright = await inkShape(page, textId);
  expect(upright.count).toBeGreaterThan(500);
  expect(Math.abs(upright.angle)).toBeLessThan(2);

  await rotateBox15(page);
  await page.screenshot({ path: `e2e/screenshots/group-text-transform-${label}-rotated.png` });
  const rotated = await inkShape(page, textId);
  const expected = turned({ x: upright.cx, y: upright.cy });
  expect(rotated.angle).toBeGreaterThan(12);
  expect(rotated.angle).toBeLessThan(18);
  expect(Math.abs(rotated.cx - expected.x)).toBeLessThan(4);
  expect(Math.abs(rotated.cy - expected.y)).toBeLessThan(4);

  // Re-render the text from its props: it must keep the rotation and stay
  // on the rectangle (it used to come back upright, shifted).
  await clickRow(page, textId);
  await setLetterSpacing(page, 2);
  await page.screenshot({ path: `e2e/screenshots/group-text-transform-${label}-spaced.png` });
  const spaced = await inkShape(page, textId);
  expect(spaced.angle).toBeGreaterThan(12);
  expect(spaced.angle).toBeLessThan(18);
  // Tracking widens the line along its rotated baseline from the anchor.
  expect(Math.abs(spaced.cx - rotated.cx)).toBeLessThan(10);
  expect(Math.abs(spaced.cy - rotated.cy)).toBeLessThan(6);
  expect(spaced.count).toBeGreaterThan(rotated.count * 0.8);

  // Undo the spacing, then the rotation: back upright where it started.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const undone = await inkShape(page, textId);
  expect(Math.abs(undone.angle)).toBeLessThan(2);
  expect(Math.abs(undone.cx - upright.cx)).toBeLessThan(2);
  expect(Math.abs(undone.cy - upright.cy)).toBeLessThan(2);

  // Redo the rotation: the restored layer still re-renders rotated.
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);
  const redone = await inkShape(page, textId);
  expect(redone.angle).toBeGreaterThan(12);
  expect(Math.abs(redone.cx - rotated.cx)).toBeLessThan(4);
  await clickRow(page, textId);
  await setLetterSpacing(page, 6);
  await page.screenshot({ path: `e2e/screenshots/group-text-transform-${label}-redone-spaced.png` });
  const respaced = await inkShape(page, textId);
  expect(respaced.angle).toBeGreaterThan(12);
  expect(respaced.angle).toBeLessThan(18);
  expect(Math.abs(respaced.cy - rotated.cy)).toBeLessThan(10);
}

test.describe('#1165 text in a multi-layer / group transform', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'layers panel and options bar need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);
  });

  test('text rotated with a Shift-selected raster layer keeps the rotation on re-render', async ({ page }) => {
    const rectId = await activeLayerId(page);
    await fillRect(page, [40, 90, 220]);
    const textId = await typeTiltMe(page);

    await clickRow(page, textId);
    await clickRow(page, rectId, ['Shift']);
    const selected = (await getEditorState(page)).document.selectedLayerIds ?? [];
    expect([...selected].sort()).toEqual([rectId, textId].sort());

    await expectTextKeepsBoxRotation(page, textId, 'multi');

    // A second turn of both layers composes with the text's stored 15°.
    // The box is now the rotated rectangle's bounds: 400 × 200 turned 15°
    // spans 219.1 px either side of the centre and 148.4 px above and below.
    const once = await inkShape(page, textId);
    await clickRow(page, textId);
    await clickRow(page, rectId, ['Shift']);
    await rotateBox15(page, { x: CENTRE.x + 219.1, y: CENTRE.y - 148.4 });
    const turnedTwice = await inkShape(page, textId);
    const expected = turned({ x: once.cx, y: once.cy });
    expect(turnedTwice.angle).toBeGreaterThan(27);
    expect(turnedTwice.angle).toBeLessThan(33);
    expect(Math.abs(turnedTwice.cx - expected.x)).toBeLessThan(5);
    expect(Math.abs(turnedTwice.cy - expected.y)).toBeLessThan(5);
    await clickRow(page, textId);
    await setLetterSpacing(page, 4);
    await page.screenshot({ path: 'e2e/screenshots/group-text-transform-multi-twice.png' });
    const twice = await inkShape(page, textId);
    expect(twice.angle).toBeGreaterThan(27);
    expect(twice.angle).toBeLessThan(33);
    expect(Math.abs(twice.cx - turnedTwice.cx)).toBeLessThan(10);
    expect(Math.abs(twice.cy - turnedTwice.cy)).toBeLessThan(10);

    // Save and reopen the project: the transform is saved with the layer,
    // so a re-render after reopening keeps the text turned.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Save Project' }).click();
    const saved = readFileSync(await (await download).path());
    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('button:has-text("Open File")'),
    ]);
    await chooser.setFiles({ name: 'tilt-me.lopsy', mimeType: 'application/octet-stream', buffer: saved });
    await expect.poll(async () => (await layerRows(page)).some((l) => l.id === textId), { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(300);
    await clickRow(page, textId);
    await setLetterSpacing(page, 1);
    await page.screenshot({ path: 'e2e/screenshots/group-text-transform-multi-reopened.png' });
    const reopened = await inkShape(page, textId);
    expect(reopened.angle).toBeGreaterThan(27);
    expect(reopened.angle).toBeLessThan(33);
    expect(Math.abs(reopened.cx - twice.cx)).toBeLessThan(10);
    expect(Math.abs(reopened.cy - twice.cy)).toBeLessThan(10);
  });

  test('text in a nested group keeps the rotation when the outer group is rotated', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const outerId = await activeLayerId(page);
    await page.locator('[aria-label="Add Layer"]').click();
    const rectId = await activeLayerId(page);
    await fillRect(page, [40, 90, 220]);
    await page.locator('[aria-label="New Group"]').click();
    const innerId = await activeLayerId(page);
    const textId = await typeTiltMe(page);

    const rows = await layerRows(page);
    const outer = rows.find((l) => l.id === outerId)!;
    const inner = rows.find((l) => l.id === innerId)!;
    expect(outer.children).toEqual(expect.arrayContaining([rectId, innerId]));
    expect(inner.children).toEqual([textId]);

    await clickRow(page, outerId);
    await expectTextKeepsBoxRotation(page, textId, 'group');
  });

  test('a Distort corner drag over live text is refused, leaving every layer as it was', async ({ page }) => {
    const rectId = await activeLayerId(page);
    await fillRect(page, [40, 90, 220]);
    const textId = await typeTiltMe(page);
    await clickRow(page, textId);
    await clickRow(page, rectId, ['Shift']);
    await selectTool(page, 'move');
    await page.locator('[aria-label="Transform mode: Distort"]').click();
    const textBefore = await inkShape(page, textId);
    const rectBefore = await inkShape(page, rectId);
    const undoBefore = (await getEditorState(page)).undoStackLength;

    // A text matrix can't follow a corner pulled out of the parallelogram.
    const corner = await findTransformHandle(page, 'bottom-right', { x: RECT.x1, y: RECT.y1 }, 10);
    const target = await docToScreen(page, RECT.x1 + 60, RECT.y1 + 40);
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/group-text-transform-distort-refused.png' });

    await expect(page.locator('[role="status"]').filter({
      hasText: 'Rasterize the text layers before distorting them with other layers.',
    })).toBeVisible();
    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore);
    const textAfter = await inkShape(page, textId);
    const rectAfter = await inkShape(page, rectId);
    expect(textAfter.count).toBe(textBefore.count);
    expect(Math.abs(textAfter.cx - textBefore.cx)).toBeLessThan(0.5);
    expect(rectAfter.count).toBe(rectBefore.count);
    expect(Math.abs(rectAfter.cx - rectBefore.cx)).toBeLessThan(0.5);
    expect(Math.abs(rectAfter.cy - rectBefore.cy)).toBeLessThan(0.5);
  });
});
