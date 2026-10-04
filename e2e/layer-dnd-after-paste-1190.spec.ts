import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, addLayer, getEditorState } from './helpers';

// #1190: after a Paste, dropping a group child in the gap below the group's
// last child sent it to the bottom of the stack, at the root. The paste only
// mattered because its extra row made the list overflow at the default
// viewport, putting that gap inside the bottom auto-scroll zone: holding the
// pointer there scrolled the list to its end, and the release landed in the
// gap now under the pointer. The zone must not reach into a row that is
// fully on screen.

// The default viewport: the layer list shows about six rows.
test.use({ viewport: { width: 1280, height: 720 } });

interface LayerInfo {
  id: string;
  name: string;
  type: string;
  children?: string[];
}

async function layerList(page: Page): Promise<LayerInfo[]> {
  const state = await getEditorState(page);
  return state.document.layers as unknown as LayerInfo[];
}

async function layerOrder(page: Page): Promise<string[]> {
  const state = await getEditorState(page);
  return (state.document as unknown as { layerOrder: string[] }).layerOrder;
}

async function parentOf(page: Page, id: string): Promise<string | null> {
  for (const l of await layerList(page)) {
    if (l.type === 'group' && l.children?.includes(id)) return l.id;
  }
  return null;
}

async function panelIds(page: Page): Promise<string[]> {
  return page.locator('[data-layer-id]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-layer-id') ?? ''),
  );
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function clickRow(page: Page, id: string): Promise<void> {
  await page.locator(`[data-layer-id="${id}"]`).click();
  await page.waitForTimeout(100);
}

async function rename(page: Page, id: string, name: string): Promise<void> {
  const row = page.locator(`[data-layer-id="${id}"]`);
  await row.locator('span[class*="name"]').first().dblclick();
  const input = row.getByLabel('Layer name');
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press('Enter');
  await page.waitForTimeout(100);
}

async function dragRowGrip(page: Page, draggedId: string, targetId: string, fraction: number): Promise<void> {
  const grip = page.locator(`[data-layer-id="${draggedId}"] [aria-label^="Drag to reorder"]`);
  const gripBox = (await grip.boundingBox())!;
  const targetBox = (await page.locator(`[data-layer-id="${targetId}"]`).boundingBox())!;
  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, targetBox.y + targetBox.height * fraction, { steps: 8 });
  // Hold still, as a user lining up the drop indicator does.
  await page.waitForTimeout(1000);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test.describe('Layers panel drag after a Paste (#1190)', () => {
  test('dropping a group child below the last child keeps it in the group', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and row grips need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForTimeout(300);

    const root = (await panelIds(page))[0]!;
    const initial = await layerList(page);
    const layer1 = initial.find((l) => l.name === 'Layer 1')!.id;
    const background = initial.find((l) => l.name === 'Background')!.id;

    await clickRow(page, layer1);
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(100);
    await page.locator('[data-testid="canvas-container"]').hover();
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(300);
    const pasted = await activeLayerId(page);
    expect((await layerList(page)).find((l) => l.id === pasted)?.name).toBe('Pasted Layer');
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);

    await clickRow(page, layer1);
    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const g = await activeLayerId(page);
    const a = await addLayer(page);
    const b = await addLayer(page);
    const c = await addLayer(page);
    for (const id of [a, b, c]) expect(await parentOf(page, id)).toBe(g);
    await rename(page, g, 'G');
    await rename(page, a, 'A');
    await rename(page, b, 'B');
    await rename(page, c, 'C');

    // The lower part of the A row sits within 24px of the list's bottom
    // edge, and the list has rows hidden below it.
    const list = page.locator('[data-testid="layer-list"]');
    const listBox = (await list.boundingBox())!;
    const aBox = (await page.locator(`[data-layer-id="${a}"]`).boundingBox())!;
    expect(listBox.y + listBox.height - (aBox.y + aBox.height * 0.85)).toBeLessThan(24);
    expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);

    expect(await panelIds(page)).toEqual([root, pasted, g, c, b, a, layer1, background]);
    // The paste leaves `layers` out of layerOrder order; the drop must not care.
    const arrayOrder = (await layerList(page)).map((l) => l.id);
    expect(arrayOrder.indexOf(pasted)).toBeGreaterThan(arrayOrder.indexOf(root));

    // Lower ~15% of the A row: the gap between A and Layer 1, at B's depth.
    await dragRowGrip(page, b, a, 0.85);
    expect(await list.evaluate((el) => el.scrollTop)).toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/layer-dnd-1190-after-paste.png' });

    expect(await parentOf(page, b)).toBe(g);
    expect(await panelIds(page)).toEqual([root, pasted, g, c, a, b, layer1, background]);
    expect(await layerOrder(page)).toEqual([background, layer1, b, a, c, g, pasted, root]);
  });
});
