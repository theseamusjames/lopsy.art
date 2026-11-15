/**
 * Text layers keep their transform as data. The Move tool shows handles
 * around a live text layer (no selection needed); rotating, scaling or
 * flipping it re-renders the glyphs through the stored matrix, so the text
 * stays editable: the Text tool edits it in place instead of snapping it
 * upright at the document origin, cancel leaves it where it was, and Text
 * panel changes keep the rotation.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, waitForStore } from './helpers';
import { findTransformHandle, getTextEditing } from './text-edit-helpers';

interface LayerSnapshot {
  id: string;
  type: string;
  text: string;
  x: number;
  y: number;
  transform: { a: number; b: number; c: number; d: number; anchorX: number; anchorY: number } | null;
}

interface Ink { minX: number; minY: number; maxX: number; maxY: number; count: number }

async function textLayer(page: Page): Promise<LayerSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<LayerSnapshot & { transform?: LayerSnapshot['transform'] }> } };
    };
    const l = store.getState().document.layers.find((layer) => layer.type === 'text')!;
    return { id: l.id, type: l.type, text: l.text, x: l.x, y: l.y, transform: l.transform ?? null };
  });
}

/** Document-space bounds of the text layer's opaque pixels. */
async function ink(page: Page): Promise<Ink> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.type === 'text')!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(layer.id);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) > 128) {
          count++;
          minX = Math.min(minX, x + layer.x);
          maxX = Math.max(maxX, x + layer.x);
          minY = Math.min(minY, y + layer.y);
          maxY = Math.max(maxY, y + layer.y);
        }
      }
    }
    return { minX, minY, maxX, maxY, count };
  });
}

function size(i: Ink): { w: number; h: number } {
  return { w: i.maxX - i.minX + 1, h: i.maxY - i.minY + 1 };
}

function centre(i: Ink): { x: number; y: number } {
  return { x: (i.minX + i.maxX) / 2, y: (i.minY + i.maxY) / 2 };
}

/** Drag from screen point `start` a quarter turn clockwise about doc point `pivot`. */
async function dragQuarterTurn(page: Page, start: { x: number; y: number }, pivot: { x: number; y: number }): Promise<void> {
  const p = await docToScreen(page, pivot.x, pivot.y);
  const angle = Math.atan2(start.y - p.y, start.x - p.x) + Math.PI / 2;
  const radius = Math.hypot(start.x - p.x, start.y - p.y);
  await page.keyboard.down('Meta');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    const a = angle - Math.PI / 2 + (Math.PI / 2) * (i / 12);
    await page.mouse.move(p.x + radius * Math.cos(a), p.y + radius * Math.sin(a));
  }
  await page.mouse.up();
  await page.keyboard.up('Meta');
  await page.waitForTimeout(200);
}

async function typeCommittedText(page: Page, docX: number, docY: number, text: string): Promise<void> {
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'text');
  await setToolOption(page, 'Size', 40);
  const at = await docToScreen(page, docX, docY);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
  await page.keyboard.type(text);
  await page.locator('button[aria-label="Commit text"]').click();
  await page.waitForTimeout(300);
}

/** Rotate the active text layer a quarter turn with the Move tool's top-right rotate handle. */
async function rotateWithMoveTool(page: Page): Promise<void> {
  await selectTool(page, 'move');
  const flat = await ink(page);
  const handle = await findTransformHandle(page, 'rotate-top-right', { x: flat.maxX + 20, y: flat.minY - 25 }, 40);
  await dragQuarterTurn(page, handle, centre(flat));
}

test.describe('transforming live text layers', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'options bar and layer panel need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
  });

  test('Move-tool handles rotate text that stays editable in place', async ({ page }) => {
    await typeCommittedText(page, 250, 260, 'HELLO');
    const flat = await ink(page);
    expect(size(flat).w).toBeGreaterThan(size(flat).h * 2);

    // No selection: the Move tool still offers handles around the text.
    await rotateWithMoveTool(page);
    const turned = await textLayer(page);
    expect(turned.type).toBe('text');
    expect(turned.transform).not.toBeNull();
    // A ⌘-snapped quarter turn clockwise: x' = −y, y' = x.
    expect(turned.transform!.a).toBeCloseTo(0, 3);
    expect(turned.transform!.b).toBeCloseTo(1, 3);
    const turnedInk = await ink(page);
    expect(Math.abs(size(turnedInk).w - size(flat).h)).toBeLessThan(6);
    expect(Math.abs(size(turnedInk).h - size(flat).w)).toBeLessThan(6);

    // The Text tool edits it where it is — no jump to the document origin.
    await selectTool(page, 'text');
    const onText = await docToScreen(page, centre(turnedInk).x, centre(turnedInk).y);
    await page.mouse.click(onText.x, onText.y);
    await page.waitForTimeout(200);
    const editing = await getTextEditing(page);
    expect(editing?.layerId).toBe(turned.id);
    let duringEdit = await ink(page);
    expect(Math.abs(duringEdit.minX - turnedInk.minX)).toBeLessThan(3);
    expect(Math.abs(duringEdit.minY - turnedInk.minY)).toBeLessThan(3);

    // Typing extends the text down the rotated baseline.
    await page.keyboard.type('!!');
    await page.waitForTimeout(200);
    duringEdit = await ink(page);
    expect(duringEdit.maxY).toBeGreaterThan(turnedInk.maxY + 10);
    expect(Math.abs(duringEdit.minX - turnedInk.minX)).toBeLessThan(3);

    // Cancel puts back the committed text exactly where it was.
    await page.locator('button[aria-label="Cancel text"]').click();
    await page.waitForTimeout(200);
    const cancelled = await textLayer(page);
    expect(cancelled.text).toBe('HELLO');
    expect(cancelled.x).toBe(turned.x);
    expect(cancelled.y).toBe(turned.y);
    expect(cancelled.transform).toEqual(turned.transform);
    const afterCancel = await ink(page);
    expect(Math.abs(afterCancel.minY - turnedInk.minY)).toBeLessThan(2);

    // A Size change re-renders the glyphs and keeps the rotation (#798).
    await setToolOption(page, 'Size', 80);
    await page.waitForTimeout(300);
    const bigger = await ink(page);
    expect(size(bigger).h).toBeGreaterThan(size(turnedInk).h * 1.6);
    expect(size(bigger).h).toBeGreaterThan(size(bigger).w * 2);
  });

  test('scaling a flipped text layer keeps it flipped and pins the opposite corner', async ({ page }) => {
    await typeCommittedText(page, 250, 260, 'MIRROR');
    await selectTool(page, 'move');
    await page.getByRole('button', { name: 'Flip Horizontal' }).click();
    await page.waitForTimeout(300);
    const flipped = await textLayer(page);
    expect(flipped.transform!.a).toBeCloseTo(-1, 6);
    const before = await ink(page);

    // After the flip the box's "bottom-left" handle sits at the right edge.
    const handle = await findTransformHandle(page, 'bottom-left', { x: before.maxX + 2, y: before.maxY + 10 }, 30);
    const to = { x: handle.x + 80, y: handle.y + 40 };
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const scaled = await textLayer(page);
    expect(scaled.transform!.a).toBeLessThan(-1.1);
    expect(scaled.transform!.d).toBeGreaterThan(1.1);
    const after = await ink(page);
    expect(size(after).w).toBeGreaterThan(size(before).w * 1.1);
    // The left edge (the box's flipped right side) stays put.
    expect(Math.abs(after.minX - before.minX)).toBeLessThan(4);
  });

  test('a ⌘-click selection rotates the live text and follows it', async ({ page }) => {
    await typeCommittedText(page, 250, 260, 'WORD');
    const row = page.locator('[class*="itemWrapper"]').filter({ has: page.getByText('WORD', { exact: true }) });
    await row.locator('div[class*="thumbnail"]').click({ modifiers: ['ControlOrMeta'] });
    await page.waitForTimeout(300);

    await rotateWithMoveTool(page);
    const turned = await textLayer(page);
    expect(turned.type).toBe('text');
    expect(turned.transform!.b).toBeCloseTo(1, 3);

    // The selection is rebuilt around the turned text.
    const turnedInk = await ink(page);
    const selection = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null } };
      };
      return store.getState().selection;
    });
    expect(selection.active).toBe(true);
    expect(Math.abs(selection.bounds!.height - size(turnedInk).h)).toBeLessThan(4);
  });

  test('a selection over part of the text refuses the move instead of baking pixels', async ({ page }) => {
    await typeCommittedText(page, 250, 260, 'PARTIAL');
    const flat = await ink(page);
    const before = await textLayer(page);

    await selectTool(page, 'marquee-rect');
    const a = await docToScreen(page, flat.minX - 5, flat.minY - 5);
    const b = await docToScreen(page, (flat.minX + flat.maxX) / 2, flat.maxY + 5);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();

    await selectTool(page, 'move');
    const from = await docToScreen(page, flat.minX + 10, (flat.minY + flat.maxY) / 2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 60, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await expect(page.getByText('Rasterize the text layer to move or transform part of it.')).toBeVisible();
    expect(await textLayer(page)).toEqual(before);
  });
});
