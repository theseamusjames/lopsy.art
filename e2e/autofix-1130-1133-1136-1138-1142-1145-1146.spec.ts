import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getEditorState,
  getPixelAt,
  setActiveLayer,
  setToolOption,
  setForegroundColor,
  enableEffect,
  setEffectColor,
  undo,
} from './helpers';

/**
 * #1130 — rotating a group with a marquee active changed nothing but still
 *         pushed a Transform history step.
 * #1133 — Selection → Path traced only one region of a multi-part selection.
 * #1136 — effect colour edits recorded no history step.
 * #1138 — scaling a rotated transform box didn't pin the opposite edge.
 * #1142 — Define Pattern ignored a moved layer's texture offset.
 * #1145 — Add Layer with a collapsed group active hid the new layer inside it.
 * #1146 — the Clone Stamp source preview showed the composite, not the layer.
 */

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number, isAdditive = false): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  if (isAdditive) await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  if (isAdditive) await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
}

async function clickMenu(page: Page, menu: string, item: string): Promise<void> {
  await page.click(`button:has-text("${menu}")`);
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(150);
}

async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

async function dragDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((e) => e.label);
  });
}

async function compositeAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    // The readback is the bottom-up screen canvas (document plus pasteboard),
    // so map through the viewport rather than scaling across the canvas.
    const { width, height, pixels } = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const px = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + width / 2);
    const py = height - 1 - Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + height / 2);
    const i = (py * width + px) * 4;
    return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
  }, { x, y });
}

test.describe('autofix #1130 #1133 #1136 #1138 #1142 #1145 #1146', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
  });

  test('#1136 a colour edit on Color Overlay is its own undo step', async ({ page }) => {
    await setForegroundColor(page, 0, 0, 0);
    await clickMenu(page, 'Edit', 'Fill');
    await enableEffect(page, 'Color Overlay');
    await page.waitForTimeout(150);
    const before = await historyLabels(page);
    expect(before[before.length - 1]).toBe('Enable Color Overlay');

    await setEffectColor(page, 'Overlay color', 0x20, 0x40, 0xc0);
    await page.waitForTimeout(200);
    expect(await compositeAt(page, 400, 300)).toEqual([0x20, 0x40, 0xc0]);
    const after = await historyLabels(page);
    expect(after).toEqual([...before, 'Edit Color Overlay']);

    await undo(page);
    await page.waitForTimeout(250);
    expect(await historyLabels(page)).toEqual(before);
    // The overlay is still on, back at its default red.
    const [r, g, b] = await compositeAt(page, 400, 300);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(40);
    expect(b).toBeLessThan(40);
  });

  test('#1145 Add Layer with a collapsed group active adds a visible sibling', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(100);
    const groupId = (await getEditorState(page)).document.activeLayerId!;
    await page.locator('button[aria-label="Collapse group Group"]').click();
    await page.waitForTimeout(100);

    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(150);

    const { document: doc } = await getEditorState(page);
    const newId = doc.activeLayerId!;
    expect(newId).not.toBe(groupId);
    await expect(page.locator(`[data-layer-id="${newId}"]`)).toBeVisible();
    const group = doc.layers.find((l) => l.id === groupId) as unknown as { children: string[]; collapsed: boolean };
    expect(group.children).not.toContain(newId);
    expect(group.collapsed).toBe(true);
    // Directly above the group in the stack.
    const order = doc.layerOrder as string[];
    expect(order.indexOf(newId)).toBe(order.indexOf(groupId) + 1);
  });

  test('#1142 Define Pattern on a moved layer reads the marquee at its document position', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 100, 100, 160, 160);
    await clickMenu(page, 'Edit', 'Fill');
    await deselect(page);
    await page.keyboard.press('v');
    await dragDoc(page, { x: 130, y: 130 }, { x: 330, y: 130 });
    expect(await compositeAt(page, 330, 130)).toEqual([255, 0, 0]);
    expect(await compositeAt(page, 130, 130)).toEqual([255, 255, 255]);

    await dragMarquee(page, 300, 100, 360, 160);
    await clickMenu(page, 'Edit', 'Define Pattern');
    await deselect(page);

    // Fill a fresh layer with the new pattern: it must be the red square.
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(100);
    const target = (await getEditorState(page)).document.activeLayerId!;
    await page.click('button:has-text("Edit")');
    await page.click('button[role="menuitem"]:has-text("Fill with Pattern")');
    const dialog = page.locator('[role="dialog"][aria-label="Pattern Fill"]');
    await expect(dialog).toBeVisible();
    const swatches = dialog.locator('button[class*="patternSwatch"]');
    await expect(swatches).toHaveCount(1);
    await swatches.first().click();
    await dialog.locator('button:has-text("Apply")').click();
    await expect(dialog).not.toBeVisible();
    await page.waitForTimeout(200);

    const px = await getPixelAt(page, 30, 30, target);
    expect(px.r).toBeGreaterThan(200);
    expect(px.g).toBeLessThan(40);
    expect(px.a).toBe(255);
  });

  test('#1138 scaling a rotated selection keeps the opposite edge pinned', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 0, 0, 0);
    await dragMarquee(page, 200, 250, 600, 350);
    await clickMenu(page, 'Edit', 'Fill');
    await page.keyboard.press('v');
    await page.waitForTimeout(100);

    const theta = -Math.PI / 6;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const rot = (x: number, y: number) => ({ x: 400 + x * cos - y * sin, y: 300 + x * sin + y * cos });

    // Rotate −30° from the top-right rotate handle (20 px outside the corner).
    await dragDoc(page, { x: 620, y: 230 }, rot(220, -70));
    // Then stretch the right edge 150 px outward along the bar's own axis.
    await dragDoc(page, rot(200, 0), rot(350, 0));
    await deselect(page);

    // Points 20 px in from each end, 40 px off the axis on either side.
    // With #1138 the whole bar slid ~37 px sideways, so the probes on one
    // side fell outside it.
    const probes = [rot(-180, -40), rot(-180, 40), rot(330, -40), rot(330, 40)];
    for (const p of probes) {
      const px = await getPixelAt(page, Math.round(p.x), Math.round(p.y), layerId);
      expect(px.a, `inside the bar at (${Math.round(p.x)}, ${Math.round(p.y)})`).toBeGreaterThan(200);
    }
    // Just past the pinned left end stays empty.
    const outside = rot(-215, 0);
    expect((await getPixelAt(page, Math.round(outside.x), Math.round(outside.y), layerId)).a).toBeLessThan(30);
  });

  test('#1130 rotating a group through a marquee is refused without a history step', async ({ page }) => {
    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 200, 200, 500, 400);
    await clickMenu(page, 'Edit', 'Fill');
    await deselect(page);
    await clickMenu(page, 'Layer', 'Group Layers');
    const before = await historyLabels(page);

    await dragMarquee(page, 150, 150, 550, 450);
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    await dragDoc(page, { x: 570, y: 130 }, { x: 640, y: 260 });
    await expect(page.getByText('Deselect to transform the whole group', { exact: false })).toBeVisible();
    await deselect(page);

    expect(await historyLabels(page)).toEqual(before);
  });

  test('#1133 Selection → Path traces both regions of a two-part selection', async ({ page }) => {
    await dragMarquee(page, 100, 100, 300, 250);
    await dragMarquee(page, 450, 300, 700, 520, true);
    await clickMenu(page, 'Select', 'Selection → Path');

    const paths = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: Array<{ anchors: Array<{ point: { x: number; y: number } }> }> };
      };
      return store.getState().paths.map((p) => {
        const xs = p.anchors.map((a) => a.point.x);
        const ys = p.anchors.map((a) => a.point.y);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      });
    });
    expect(paths).toHaveLength(2);
    expect(paths[0]![0]).toBeCloseTo(100, -1);
    expect(paths[0]![1]).toBeCloseTo(100, -1);
    expect(paths[1]![2]).toBeCloseTo(700, -1);
    expect(paths[1]![3]).toBeCloseTo(520, -1);
  });

  test('#1146 the Clone Stamp preview shows the active layer, not the composite', async ({ page }) => {
    const { document: doc } = await getEditorState(page);
    const layer1 = doc.activeLayerId!;
    const background = doc.layers.find((l) => l.name === 'Background')!.id;
    await setActiveLayer(page, background);
    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 100, 100, 300, 300);
    await clickMenu(page, 'Edit', 'Fill');
    await deselect(page);

    await page.keyboard.press('s');
    await page.waitForTimeout(100);
    await setToolOption(page, 'Size', 120);
    const source = await docToScreen(page, 200, 200);
    await page.keyboard.down('Alt');
    await page.mouse.click(source.x, source.y);
    await page.keyboard.up('Alt');
    await page.waitForTimeout(100);

    const previewRed = async (): Promise<number> => {
      const hover = await docToScreen(page, 550, 300);
      await page.mouse.move(hover.x - 2, hover.y);
      await page.mouse.move(hover.x, hover.y);
      await page.waitForTimeout(250);
      // The engine draws the preview disc on the screen canvas, under the
      // overlay's ring. Count red samples a few pixels off-centre; the
      // document under the cursor is white.
      let red = 0;
      for (const [dx, dy] of [[8, 8], [-8, 8], [8, -8], [-8, -8]]) {
        const [r, g] = await compositeAt(page, 550 + dx!, 300 + dy!);
        if (r > 150 && g < 100) red++;
      }
      return red;
    };

    // Stamping on the Background samples the red square: the preview shows it.
    expect(await previewRed()).toBe(4);

    // Layer 1 is empty: the stamp paints nothing, and the preview agrees.
    await setActiveLayer(page, layer1);
    await page.waitForTimeout(100);
    expect(await previewRed()).toBe(0);
  });
});
