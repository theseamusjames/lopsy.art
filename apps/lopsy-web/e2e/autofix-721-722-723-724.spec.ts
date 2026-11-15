import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  setForegroundColor,
  drawRect,
  getPixelAt,
  getEditorState,
  docToScreen,
} from './helpers';

// Coverage for the nightly autofix batch:
// - #721 (bare click on the move tool must not record a history entry)
// - #722 (fill tool no longer forces a 134 MB round-trip on tool-down)
// - #723 (composite-dirty tracks Channels-panel eye-icon toggles)
// - #724 (paste identity check no longer reads the clipboard texture back)

test.describe('#721 — bare click on move tool records no history', () => {
  test('click without any drag adds zero entries to the undo stack', async ({ page, isMobile }) => {
    test.skip(isMobile, 'move tool tests use desktop pointer events');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // A single history entry is already on the stack from createDocument.
    const stackBefore = (await getEditorState(page)).undoStackLength;

    await selectTool(page, 'move');

    // Click and release at the same screen position — zero drag delta.
    const center = await docToScreen(page, 200, 150);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(80);

    const stackAfter = (await getEditorState(page)).undoStackLength;
    expect(stackAfter).toBe(stackBefore);
  });

  test('an actual drag records exactly one "Move" entry', async ({ page, isMobile }) => {
    test.skip(isMobile, 'move tool tests use desktop pointer events');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // Give the layer some content so the move actually shifts something visible.
    await drawRect(page, 100, 80, 60, 40, { r: 0, g: 200, b: 255 });
    await page.waitForTimeout(80);

    const stackBefore = (await getEditorState(page)).undoStackLength;

    await selectTool(page, 'move');
    const start = await docToScreen(page, 130, 100);
    const end = await docToScreen(page, 170, 130);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);

    const stackAfter = (await getEditorState(page)).undoStackLength;
    expect(stackAfter).toBe(stackBefore + 1);
  });
});

test.describe('#722 — bucket fill on a moved layer still lands at the click point', () => {
  test('non-contiguous fill on a layer offset by (30, 20) fills the clicked color', async ({ page, isMobile }) => {
    test.skip(isMobile, 'fill tool tests use desktop pointer events');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);

    // Paint a red patch, then move the layer so layer.x/y become non-zero.
    // The regression scenario is a layer whose stored bounds don't line up
    // with (0, 0) — before the fix, `handleToolDown` forced an
    // `expandLayerForEditing` that reset those bounds; after the fix, the
    // fill handler owns its own doc-space coordinate math.
    await drawRect(page, 40, 40, 80, 60, { r: 220, g: 30, b: 30 });
    await page.waitForTimeout(80);

    // Nudge the layer with the move tool to force a non-zero layer offset.
    await selectTool(page, 'move');
    const start = await docToScreen(page, 80, 70);
    const end = await docToScreen(page, 110, 100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    // Sanity: the active layer should now sit at a non-zero offset.
    const st = await getEditorState(page);
    const activeId = st.document.activeLayerId;
    const active = st.document.layers.find((l) => l.id === activeId)!;
    expect(active.x !== 0 || active.y !== 0).toBe(true);

    // Fill by color, non-contiguous (the #722 fast path that used to be
    // silently pre-empted by the 134 MB expandLayerForEditing round-trip).
    await selectTool(page, 'fill');
    await page.evaluate(() => {
      const store = (window as unknown as { __toolSettingsStore: {
        getState: () => { setFillSetting: (k: string, v: number | boolean) => void };
      } }).__toolSettingsStore;
      store.getState().setFillSetting('contiguous', false);
      store.getState().setFillSetting('tolerance', 10);
    });
    await setForegroundColor(page, 20, 220, 60);

    // Click one of the red pixels — after the move, doc-space (80, 70) is
    // where the red patch's original center now lives.
    const fillClick = await docToScreen(page, 80, 70);
    await page.mouse.move(fillClick.x, fillClick.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);

    // The click-target pixel must now be the fill color, not the pre-fill red.
    const filled = await getPixelAt(page, 80, 70);
    expect(filled.g).toBeGreaterThan(180);
    expect(filled.r).toBeLessThan(60);
  });
});

// #723 (composite-dirty subscribes to UI-store fields) and #724 (paste
// identity no longer reads the clipboard texture back) are unit-tested at
// their layer — see:
//  - src/panels/NavigatorPanel/composite-dirty.test.ts
//  - src/app/store/clipboard-image-match.test.ts
// Both fixes are pure JS-layer behaviour a Playwright browser cannot
// observe without an instrumented build (the point of the fix is the
// absence of a call), so the unit coverage carries the regression contract.
