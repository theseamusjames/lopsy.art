/**
 * Characterization: the View menu, item by item, as it behaves today.
 *
 * These specs pin what each item does (zoom and pan, the UI flag it flips,
 * its checkmark, and that it pushes no history) so the move onto the command
 * registry can be checked against them. Behaviour that looks wrong is pinned
 * as-is and says so. Disagreement ids (D10, D11, D12) refer to the surface
 * inventory; the key side of each lives with the keyboard specs.
 *
 * The menu has no aria-checked: a checked item shows a "✓" in an
 * aria-hidden slot, which `menuCheckmark` reads.
 */
import { test, expect, type Page } from './fixtures';
import {
  clickMenu,
  fillRect,
  floatSelection,
  historyLabels,
  layerPixelHash,
  openDialogName,
  openDocument,
  surfaceState,
  toasts,
} from './surface-helpers';
import { menuCheckmark, panWithSpace, viewFlags, viewport, type ViewFlags } from './surface-helpers-file';

const RED = { r: 255, g: 0, b: 0 };

/** The canvas container's rect, which the ResizeObserver feeds into viewport.width/height. */
async function containerSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="canvas-container"]');
    if (!el) throw new Error('no canvas container');
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
}

async function actualSize(page: Page): Promise<void> {
  await clickMenu(page, 'View', 'Actual Size');
  const v = await viewport(page);
  expect(v.zoom).toBe(1);
}

test.describe('View menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  test('D11: Zoom In and Zoom Out step through the fixed zoom levels and keep the pan', async ({ page }) => {
    await actualSize(page);
    await panWithSpace(page, 60, 40);
    const panned = await viewport(page);
    expect(panned.zoom).toBe(1);
    expect(panned.panX).not.toBe(0);
    expect(panned.panY).not.toBe(0);

    await clickMenu(page, 'View', 'Zoom In');
    let v = await viewport(page);
    expect(v.zoom).toBe(2);
    expect({ x: v.panX, y: v.panY }).toEqual({ x: panned.panX, y: panned.panY });

    await clickMenu(page, 'View', 'Zoom In');
    expect((await viewport(page)).zoom).toBe(3);

    await clickMenu(page, 'View', 'Zoom Out');
    await clickMenu(page, 'View', 'Zoom Out');
    await clickMenu(page, 'View', 'Zoom Out');
    v = await viewport(page);
    expect(v.zoom).toBe(0.6667);
    await clickMenu(page, 'View', 'Zoom Out');
    expect((await viewport(page)).zoom).toBe(0.5);
    v = await viewport(page);
    expect({ x: v.panX, y: v.panY }).toEqual({ x: panned.panX, y: panned.panY });

    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
  });

  test('D11: Zoom In from an off-level zoom lands on the next level up', async ({ page }) => {
    // The initial fit of a 200x150 document is capped at 1, so step down
    // first and then come back up through Fit to Screen's fractional zoom.
    await clickMenu(page, 'View', 'Fit to Screen');
    const fitted = (await viewport(page)).zoom;
    expect(Number.isInteger(fitted)).toBe(false);

    await clickMenu(page, 'View', 'Zoom In');
    expect((await viewport(page)).zoom).toBe(Math.floor(fitted) + 1);
  });

  test('D10: Fit to Screen sets zoom to 0.9 x min(vw/dw, vh/dh) of the container and pans to 0,0', async ({ page }) => {
    await actualSize(page);
    await panWithSpace(page, -50, 30);
    expect((await viewport(page)).panX).not.toBe(0);

    await clickMenu(page, 'View', 'Fit to Screen');

    const v = await viewport(page);
    const rect = await containerSize(page);
    expect(v.width).toBeCloseTo(rect.width, 3);
    expect(v.height).toBeCloseTo(rect.height, 3);
    const expected = Math.min(rect.width / 200, rect.height / 150) * 0.9;
    expect(v.zoom).toBeCloseTo(expected, 6);
    // Unlike fitToView (open/paste), the menu formula is not capped at 1.
    expect(v.zoom).toBeGreaterThan(1);
    expect(v.panX).toBe(0);
    expect(v.panY).toBe(0);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D12: Actual Size sets zoom 1 and pans to 0,0', async ({ page }) => {
    await clickMenu(page, 'View', 'Fit to Screen');
    await panWithSpace(page, 70, -30);
    const before = await viewport(page);
    expect(before.zoom).not.toBe(1);
    expect(before.panX).not.toBe(0);

    await clickMenu(page, 'View', 'Actual Size');

    const v = await viewport(page);
    expect(v.zoom).toBe(1);
    expect(v.panX).toBe(0);
    expect(v.panY).toBe(0);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('the initial show/snap flags match the checkmarks', async ({ page }) => {
    const flags = await viewFlags(page);
    expect(flags).toEqual({
      showRulers: true,
      rulerUnit: 'px',
      showGrid: false,
      showPixelGrid: true,
      showGuides: true,
      snapToGrid: false,
      snapToLayers: false,
      snapToGuides: true,
      showSeamlessPattern: false,
    });
    expect(await menuCheckmark(page, 'View', 'Show Rulers')).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Show Grid')).toBe(false);
    expect(await menuCheckmark(page, 'View', 'Show Pixel Grid')).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Show Guides')).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Snap to Grid')).toBe(false);
    expect(await menuCheckmark(page, 'View', 'Snap to Layers')).toBe(false);
    expect(await menuCheckmark(page, 'View', 'Snap to Guides')).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Show Seamless Pattern')).toBe(false);
    // The zoom items carry no checkmark slot.
    expect(await menuCheckmark(page, 'View', 'Zoom In')).toBeNull();
  });

  type ToggleItem =
    | 'Show Rulers' | 'Show Pixel Grid' | 'Show Guides'
    | 'Snap to Grid' | 'Snap to Layers' | 'Snap to Guides' | 'Show Seamless Pattern';
  const toggles: Array<{ item: ToggleItem; flag: keyof ViewFlags }> = [
    { item: 'Show Rulers', flag: 'showRulers' },
    { item: 'Show Pixel Grid', flag: 'showPixelGrid' },
    { item: 'Show Guides', flag: 'showGuides' },
    { item: 'Snap to Grid', flag: 'snapToGrid' },
    { item: 'Snap to Layers', flag: 'snapToLayers' },
    { item: 'Snap to Guides', flag: 'snapToGuides' },
    { item: 'Show Seamless Pattern', flag: 'showSeamlessPattern' },
  ];

  for (const t of toggles) {
    test(`${t.item} flips ${t.flag} and its checkmark, and only that flag, with no history`, async ({ page }) => {
      const before = await viewFlags(page);
      const initial = before[t.flag] as boolean;
      expect(await menuCheckmark(page, 'View', t.item)).toBe(initial);

      await clickMenu(page, 'View', t.item);
      const after = await viewFlags(page);
      expect(after).toEqual({ ...before, [t.flag]: !initial });
      expect(await menuCheckmark(page, 'View', t.item)).toBe(!initial);

      await clickMenu(page, 'View', t.item);
      expect(await viewFlags(page)).toEqual(before);
      expect(await menuCheckmark(page, 'View', t.item)).toBe(initial);

      expect(await historyLabels(page)).toEqual(['New Document']);
      expect(await toasts(page)).toEqual([]);
      expect(await openDialogName(page)).toBeNull();
    });
  }

  test('Show Grid turns snapToGrid on with it until the user toggles snap, then flips only the grid', async ({ page }) => {
    await clickMenu(page, 'View', 'Show Grid');
    let f = await viewFlags(page);
    expect(f.showGrid).toBe(true);
    expect(f.snapToGrid).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Show Grid')).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Snap to Grid')).toBe(true);

    await clickMenu(page, 'View', 'Show Grid');
    f = await viewFlags(page);
    expect(f.showGrid).toBe(false);
    // Hiding the grid leaves snap on.
    expect(f.snapToGrid).toBe(true);

    await clickMenu(page, 'View', 'Snap to Grid');
    expect((await viewFlags(page)).snapToGrid).toBe(false);
    await clickMenu(page, 'View', 'Show Grid');
    f = await viewFlags(page);
    expect(f.showGrid).toBe(true);
    expect(f.snapToGrid).toBe(false);

    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('Units sets rulerUnit and moves the checkmark, with no history', async ({ page }) => {
    expect(await menuCheckmark(page, 'View', 'Units', 'Pixels')).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Units', 'Inches')).toBe(false);

    await clickMenu(page, 'View', 'Units', 'Inches');
    expect((await viewFlags(page)).rulerUnit).toBe('in');
    expect(await menuCheckmark(page, 'View', 'Units', 'Inches')).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Units', 'Pixels')).toBe(false);

    await clickMenu(page, 'View', 'Units', 'Points');
    expect((await viewFlags(page)).rulerUnit).toBe('pt');
    await clickMenu(page, 'View', 'Units', 'Millimeters');
    expect((await viewFlags(page)).rulerUnit).toBe('mm');
    await clickMenu(page, 'View', 'Units', 'Pixels');
    expect((await viewFlags(page)).rulerUnit).toBe('px');

    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  test('Renderer marks the running renderer, and choosing it again only toasts', async ({ page }) => {
    // Choosing the other renderer is not driven here: it stores a choice that
    // the next load would act on (renderer-choice.spec.ts covers that).
    const running = await page.evaluate(() =>
      (window as unknown as { __wasmBridge: { rendererName: () => string } }).__wasmBridge.rendererName(),
    );
    const label = running === 'wgpu' ? 'WebGPU (Experimental)' : 'WebGL';
    const other = running === 'wgpu' ? 'WebGL' : 'WebGPU (Experimental)';
    const name = running === 'wgpu' ? 'WebGPU' : 'WebGL';
    expect(await menuCheckmark(page, 'View', 'Renderer', label)).toBe(true);
    expect(await menuCheckmark(page, 'View', 'Renderer', other)).toBe(false);
    const docId = await page.evaluate(() =>
      (window as unknown as { __editorStore: { getState: () => { document: { id: string } } } }).__editorStore.getState().document.id,
    );

    await clickMenu(page, 'View', 'Renderer', label);

    expect(await toasts(page)).toEqual([`Lopsy is using the ${name} renderer.`]);
    expect(await page.evaluate(() => localStorage.getItem('lopsy:renderer'))).toBe(running);
    expect(await page.evaluate(() =>
      (window as unknown as { __editorStore: { getState: () => { document: { id: string } } } }).__editorStore.getState().document.id,
    )).toBe(docId);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('zooming, fitting and toggling with a live Move float leave the float alone', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
    const floating = await surfaceState(page);
    expect(floating.hasFloat).toBe(true);
    const hash = await layerPixelHash(page, layer);

    await clickMenu(page, 'View', 'Zoom In');
    await clickMenu(page, 'View', 'Zoom Out');
    await clickMenu(page, 'View', 'Fit to Screen');
    await clickMenu(page, 'View', 'Actual Size');
    await clickMenu(page, 'View', 'Show Grid');
    await clickMenu(page, 'View', 'Show Rulers');
    await clickMenu(page, 'View', 'Snap to Layers');
    await clickMenu(page, 'View', 'Units', 'Inches');

    const s = await surfaceState(page);
    expect(s.hasFloat).toBe(true);
    expect(s.hasTransform).toBe(true);
    expect(s.selection.bounds).toEqual(floating.selection.bounds);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);
    expect(await layerPixelHash(page, layer)).toBe(hash);
  });
});
