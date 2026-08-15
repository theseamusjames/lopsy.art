import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, openEffectsPanel } from './helpers';

// Coverage for the nightly autofix batch:
// - issue #717 (Cmd+hover on the ruler labels the value as a fraction)
// - issue #718 (effects drawer anchors to the top of the Layers panel)

async function getRulerHover(page: Page): Promise<{ orientation: string; position: number; snap: boolean } | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { rulerHover: null | { orientation: string; position: number; snap: boolean } };
    };
    return store.getState().rulerHover;
  });
}

async function setRulersAndGuides(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => {
        showRulers: boolean;
        showGuides: boolean;
        setShowRulers: (v: boolean) => void;
        setShowGuides: (v: boolean) => void;
      };
    };
    const s = store.getState();
    if (!s.showRulers) s.setShowRulers(true);
    if (!s.showGuides) s.setShowGuides(true);
  });
}

test.describe('#717 — Cmd+hover over ruler snaps position to a fraction', () => {
  test('hovering the horizontal ruler with Cmd sets snap=true and snaps position', async ({ page, isMobile }) => {
    test.skip(isMobile, 'ruler is a desktop-only surface');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1000, 600, false);
    await setRulersAndGuides(page);

    const container = page.locator('[data-testid="canvas-container"]');
    const rect = await container.boundingBox();
    if (!rect) throw new Error('canvas container missing');

    // Hover somewhere on the horizontal ruler (top strip, 20px tall), plain — no modifier.
    const midX = rect.x + rect.width / 2;
    const rulerY = rect.y + 10;
    await page.mouse.move(midX, rulerY);
    // Poll: pointerMove sets rulerHover asynchronously.
    await expect.poll(async () => (await getRulerHover(page))?.snap).toBe(false);
    const plain = await getRulerHover(page);
    expect(plain).not.toBeNull();
    expect(plain!.orientation).toBe('vertical');

    // Now hold Meta and move — the position should snap and snap=true.
    await page.keyboard.down('Meta');
    // Aim slightly off the exact midpoint so we can tell "snapping happened".
    const offMid = rect.x + rect.width / 2 - 6; // small offset in screen space
    await page.mouse.move(offMid, rulerY);
    await expect.poll(async () => (await getRulerHover(page))?.snap).toBe(true);
    const snapped = await getRulerHover(page);
    await page.keyboard.up('Meta');

    expect(snapped).not.toBeNull();
    expect(snapped!.snap).toBe(true);
    // 1/2 of docWidth=1000 is 500. The screen offset was small (~6px at 1x zoom),
    // still well within the snap radius of the midpoint fraction.
    expect(snapped!.position).toBe(500);
  });

  test('hovering the vertical ruler with Cmd snaps to a fraction of doc height', async ({ page, isMobile }) => {
    test.skip(isMobile, 'ruler is a desktop-only surface');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 1200, false);
    await setRulersAndGuides(page);

    const container = page.locator('[data-testid="canvas-container"]');
    const rect = await container.boundingBox();
    if (!rect) throw new Error('canvas container missing');

    // Vertical ruler is the left strip.
    const rulerX = rect.x + 10;
    const midY = rect.y + rect.height / 2;

    await page.keyboard.down('Meta');
    await page.mouse.move(rulerX, midY);
    await expect.poll(async () => (await getRulerHover(page))?.snap).toBe(true);
    const snapped = await getRulerHover(page);
    await page.keyboard.up('Meta');

    expect(snapped).not.toBeNull();
    expect(snapped!.snap).toBe(true);
    expect(snapped!.orientation).toBe('horizontal');
    // 1/2 of docHeight=1200 = 600. If the fit-to-view centered the doc so
    // midY ≈ 1/2 * docHeight, then snap picks the midpoint.
    expect(snapped!.position).toBe(600);
  });
});

test.describe('#718 — effects drawer anchors to the top of the Layers panel', () => {
  test('drawer top lines up with the Layers panel group, not the viewport top', async ({ page, isMobile }) => {
    test.skip(isMobile, 'sidebar area is hidden on narrow viewports');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, false);

    // Find the Layers panel's group element. Default layout stacks Color+Info
    // above Layers+Channels in the right dock, so the layers group top is
    // clearly non-zero.
    const layersGroup = page.locator('[data-dock-group]:has([data-dock-tab="layers"])');
    await expect(layersGroup).toBeVisible();
    const layersRectBefore = await layersGroup.boundingBox();
    if (!layersRectBefore) throw new Error('layers panel group missing');
    // Sanity: the layers panel is NOT at the top of the app (proves the anchor is meaningful).
    expect(layersRectBefore.y).toBeGreaterThan(80);

    await openEffectsPanel(page);
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer).toBeVisible();
    const drawerRect = await drawer.boundingBox();
    if (!drawerRect) throw new Error('effects drawer missing');

    // The drawer's top should track the layers panel top within a small tolerance.
    // Ancestor borders and rounding can introduce a 1-2px delta.
    expect(Math.abs(drawerRect.y - layersRectBefore.y)).toBeLessThan(4);
  });
});
