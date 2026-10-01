import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  createDocument,
  docToScreen,
  drawRect,
  getEditorState,
  getPixelAt,
  selectTool,
  waitForStore,
} from './helpers';

// Several layers selected in the Layers panel, Move tool, no marquee: the
// transform handles frame the union of their content, and a handle drag
// transforms every one of them about that union's centre.
//
// Layout (500 × 320 doc, transparent):
//   Layer 1 — yellow 30×30 at (20, 260): NOT selected, must not move.
//   red     — 40×40 at (60, 130)
//   green   — 40×20 at (180, 140)  (wide, so a quarter turn makes it tall)
//   blue    — 40×40 at (300, 130)
// Union of the three selected layers: (60, 130)–(340, 170), centre (200, 150).

interface Layers {
  yellow: string;
  red: string;
  green: string;
  blue: string;
}

type Rgba = { r: number; g: number; b: number; a: number };

async function setUp(page: Page): Promise<Layers> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 500, 320, true);
  const yellow = (await getEditorState(page)).document.activeLayerId;
  await drawRect(page, 20, 260, 30, 30, { r: 255, g: 220, b: 0 });
  const red = await addLayer(page);
  await drawRect(page, 60, 130, 40, 40, { r: 255, g: 0, b: 0 });
  const green = await addLayer(page);
  await drawRect(page, 180, 140, 40, 20, { r: 0, g: 255, b: 0 });
  const blue = await addLayer(page);
  await drawRect(page, 300, 130, 40, 40, { r: 0, g: 0, b: 255 });
  return { yellow, red, green, blue };
}

/** Click the top layer's row, Shift+click the bottom one: the range is selected. */
async function selectRange(page: Page, top: string, bottom: string): Promise<void> {
  await page.locator(`[data-layer-id="${top}"] span[class*="name"]`).first().click();
  await page.locator(`[data-layer-id="${bottom}"] span[class*="name"]`).first().click({ modifiers: ['Shift'] });
  await page.waitForTimeout(100);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, meta = false): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  if (meta) await page.keyboard.down('Meta');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  if (meta) await page.keyboard.up('Meta');
  await page.waitForTimeout(150);
}

function expectColor(px: Rgba, color: 'red' | 'green' | 'blue' | 'yellow'): void {
  expect(px.a).toBeGreaterThan(200);
  if (color === 'red') expect(px.r > 200 && px.g < 60 && px.b < 60).toBe(true);
  if (color === 'green') expect(px.g > 200 && px.r < 60 && px.b < 60).toBe(true);
  if (color === 'blue') expect(px.b > 200 && px.r < 60 && px.g < 60).toBe(true);
  if (color === 'yellow') expect(px.r > 200 && px.g > 180 && px.b < 60).toBe(true);
}

function expectEmpty(px: Rgba): void {
  expect(px.a).toBeLessThan(20);
}

async function expectOriginalLayout(page: Page, l: Layers): Promise<void> {
  expectColor(await getPixelAt(page, 80, 150, l.red), 'red');
  expectColor(await getPixelAt(page, 185, 150, l.green), 'green');
  expectEmpty(await getPixelAt(page, 200, 135, l.green));
  expectColor(await getPixelAt(page, 320, 150, l.blue), 'blue');
  expectColor(await getPixelAt(page, 35, 275, l.yellow), 'yellow');
}

test.describe('multi-layer transform', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });

  test('a Cmd-snapped 90° rotate turns three layers about their shared centre, undone in one step', async ({ page }) => {
    const l = await setUp(page);
    await selectRange(page, l.blue, l.red);
    const selected = (await page.evaluate(() => {
      const s = (window as unknown as { __editorStore: { getState: () => { document: { selectedLayerIds: string[] } } } }).__editorStore;
      return s.getState().document.selectedLayerIds;
    })).slice().sort();
    expect(selected).toEqual([l.red, l.green, l.blue].sort());
    await selectTool(page, 'move');
    await expectOriginalLayout(page, l);
    await page.screenshot({ path: 'e2e/screenshots/multi-layer-transform-before.png' });

    const undoBefore = (await getEditorState(page)).undoStackLength;

    // Rotate handle of the top-right corner: 20 px out from (340, 130).
    // Drag it a quarter turn clockwise about (200, 150) with Cmd held
    // (15° snap), which lands the rotation on exactly 90°.
    const handle = { x: 360, y: 110 };
    const turned = { x: 200 - (handle.y - 150), y: 150 + (handle.x - 200) };
    await drag(page, handle, turned, true);
    await page.screenshot({ path: 'e2e/screenshots/multi-layer-transform-rotated.png' });

    // (x, y) → (200 − (y − 150), 150 + (x − 200)): the row of layers stands
    // up as a column through the centre.
    expectColor(await getPixelAt(page, 200, 30, l.red), 'red');
    expectEmpty(await getPixelAt(page, 80, 150, l.red));
    expectColor(await getPixelAt(page, 200, 135, l.green), 'green');
    expectEmpty(await getPixelAt(page, 185, 150, l.green));
    expectColor(await getPixelAt(page, 200, 270, l.blue), 'blue');
    expectEmpty(await getPixelAt(page, 320, 150, l.blue));
    // The unselected layer stays where it was.
    expectColor(await getPixelAt(page, 35, 275, l.yellow), 'yellow');

    // Exactly one history row for the whole rotation, all three layers.
    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore + 1);

    // ⌘D commits the transform; the layers keep the rotated pixels.
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    expectColor(await getPixelAt(page, 200, 30, l.red), 'red');
    expectColor(await getPixelAt(page, 200, 270, l.blue), 'blue');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await expectOriginalLayout(page, l);
    expectEmpty(await getPixelAt(page, 200, 30, l.red));
    expectEmpty(await getPixelAt(page, 200, 270, l.blue));
    await page.screenshot({ path: 'e2e/screenshots/multi-layer-transform-undone.png' });
  });

  test('a corner-handle scale scales three layers from the pinned corner, undone in one step', async ({ page }) => {
    const l = await setUp(page);
    await selectRange(page, l.blue, l.red);
    await selectTool(page, 'move');
    const undoBefore = (await getEditorState(page)).undoStackLength;

    // Bottom-right handle at (340, 170); dragging it by (140, 20) scales the
    // 280 × 40 box by 1.5 on both axes with its top-left (60, 130) pinned.
    await drag(page, { x: 340, y: 170 }, { x: 480, y: 190 });
    await page.screenshot({ path: 'e2e/screenshots/multi-layer-transform-scaled.png' });

    // p → (60, 130) + 1.5 · (p − (60, 130))
    expectColor(await getPixelAt(page, 110, 180, l.red), 'red');
    expectColor(await getPixelAt(page, 290, 170, l.green), 'green');
    expectEmpty(await getPixelAt(page, 200, 150, l.green));
    expectColor(await getPixelAt(page, 470, 185, l.blue), 'blue');
    expectEmpty(await getPixelAt(page, 320, 150, l.blue));
    expectColor(await getPixelAt(page, 35, 275, l.yellow), 'yellow');
    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore + 1);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await expectOriginalLayout(page, l);
    expectEmpty(await getPixelAt(page, 470, 185, l.blue));
    expectEmpty(await getPixelAt(page, 110, 180, l.red));
  });

  test('a second drag carries on from the pending transform and a Move drag translates it', async ({ page }) => {
    const l = await setUp(page);
    await selectRange(page, l.blue, l.red);
    await selectTool(page, 'move');
    const undoBefore = (await getEditorState(page)).undoStackLength;

    // Two 45° Cmd-snapped steps make the same quarter turn as one.
    const handle = { x: 360, y: 110 };
    const r = Math.hypot(handle.x - 200, handle.y - 150);
    const a0 = Math.atan2(handle.y - 150, handle.x - 200);
    const at = (a: number) => ({ x: 200 + r * Math.cos(a), y: 150 + r * Math.sin(a) });
    await drag(page, handle, at(a0 + Math.PI / 4), true);
    await drag(page, at(a0 + Math.PI / 4), at(a0 + Math.PI / 2), true);

    // Then drag from inside the box: the turned column moves 40 px right.
    await drag(page, { x: 205, y: 160 }, { x: 245, y: 160 });

    expectColor(await getPixelAt(page, 240, 30, l.red), 'red');
    expectColor(await getPixelAt(page, 240, 135, l.green), 'green');
    expectColor(await getPixelAt(page, 240, 270, l.blue), 'blue');
    expectEmpty(await getPixelAt(page, 200, 30, l.red));
    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore + 3);
  });

  test('Flip Horizontal and Rotate 90° CW turn every selected layer about the shared centre', async ({ page }) => {
    const l = await setUp(page);
    await selectRange(page, l.blue, l.red);
    await selectTool(page, 'move');
    const undoBefore = (await getEditorState(page)).undoStackLength;

    // Mirrored about x = 200: red and blue swap places.
    await page.getByRole('button', { name: 'Flip Horizontal' }).click();
    await page.waitForTimeout(150);
    expectColor(await getPixelAt(page, 320, 150, l.red), 'red');
    expectEmpty(await getPixelAt(page, 80, 150, l.red));
    expectColor(await getPixelAt(page, 80, 150, l.blue), 'blue');
    expectEmpty(await getPixelAt(page, 320, 150, l.blue));
    expectColor(await getPixelAt(page, 185, 150, l.green), 'green');

    // A quarter turn clockwise about (200, 150): blue (now left) goes to
    // the top, red (now right) to the bottom.
    await page.getByRole('button', { name: 'Rotate 90° CW' }).click();
    await page.waitForTimeout(150);
    expectColor(await getPixelAt(page, 200, 30, l.blue), 'blue');
    expectColor(await getPixelAt(page, 200, 270, l.red), 'red');
    expectColor(await getPixelAt(page, 200, 135, l.green), 'green');
    expectColor(await getPixelAt(page, 35, 275, l.yellow), 'yellow');
    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore + 2);

    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await expectOriginalLayout(page, l);
  });

  test('a selected group transforms the layers inside it', async ({ page }) => {
    const l = await setUp(page);
    await selectRange(page, l.blue, l.red);
    await page.getByRole('button', { name: 'Group Layers' }).click();
    await page.waitForTimeout(200);
    const groupId = await page.evaluate((ids) => {
      const s = (window as unknown as {
        __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string; children?: string[] }> } } };
      }).__editorStore;
      return s.getState().document.layers.find((x) => x.type === 'group' && ids.every((id) => x.children?.includes(id)))?.id ?? null;
    }, [l.red, l.green, l.blue]);
    expect(groupId).not.toBeNull();
    await page.locator(`[data-layer-id="${groupId}"] span[class*="name"]`).first().click();
    await selectTool(page, 'move');

    const handle = { x: 360, y: 110 };
    await drag(page, handle, { x: 200 - (handle.y - 150), y: 150 + (handle.x - 200) }, true);

    expectColor(await getPixelAt(page, 200, 30, l.red), 'red');
    expectColor(await getPixelAt(page, 200, 135, l.green), 'green');
    expectColor(await getPixelAt(page, 200, 270, l.blue), 'blue');
    expectColor(await getPixelAt(page, 35, 275, l.yellow), 'yellow');
  });

  test('a locked layer in the selection stays put and is left out of the box', async ({ page }) => {
    const l = await setUp(page);
    // Lock blue: the box shrinks to red + green, (60, 130)–(220, 170),
    // centre (140, 150).
    await page.locator(`[data-layer-id="${l.blue}"]`).getByRole('button', { name: 'Lock layer' }).click();
    await selectRange(page, l.green, l.red);
    await page.locator(`[data-layer-id="${l.blue}"] span[class*="name"]`).first().click({ modifiers: ['Meta'] });
    await selectTool(page, 'move');

    // Bottom-right handle of the red+green box at (220, 170): drag by
    // (80, 20) → 1.5× with (60, 130) pinned.
    await drag(page, { x: 220, y: 170 }, { x: 300, y: 190 });
    expectColor(await getPixelAt(page, 110, 180, l.red), 'red');
    expectColor(await getPixelAt(page, 290, 170, l.green), 'green');
    expectEmpty(await getPixelAt(page, 200, 150, l.green));
    // Blue is untouched: same place, same size.
    expectColor(await getPixelAt(page, 302, 132, l.blue), 'blue');
    expectColor(await getPixelAt(page, 338, 168, l.blue), 'blue');
    expectEmpty(await getPixelAt(page, 345, 150, l.blue));
  });

  test('Distort maps every selected layer through one homography', async ({ page }) => {
    const l = await setUp(page);
    await selectRange(page, l.blue, l.red);
    await selectTool(page, 'move');
    await page.getByRole('button', { name: 'Transform mode: Distort' }).click();

    // Pull the box's bottom-right corner from (340, 170) to (400, 210); the
    // other three corners stay. The union rect maps onto that quad, so blue
    // (near the moved corner) is dragged out to the lower right while red
    // (at the fixed left edge) only narrows: its right edge, at x = 100,
    // lands near x = 84.
    await drag(page, { x: 340, y: 170 }, { x: 400, y: 210 });
    await page.screenshot({ path: 'e2e/screenshots/multi-layer-transform-distort.png' });
    expectColor(await getPixelAt(page, 360, 180, l.blue), 'blue');
    expectColor(await getPixelAt(page, 290, 140, l.blue), 'blue');
    expectColor(await getPixelAt(page, 70, 150, l.red), 'red');
    expectEmpty(await getPixelAt(page, 95, 150, l.red));
    expectColor(await getPixelAt(page, 35, 275, l.yellow), 'yellow');
  });
});
