import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  docToScreen,
  setForegroundColor,
  addLayer,
  getPixelAt,
  getEditorState,
} from './helpers';

// Coverage for the nightly autofix batch:
// - #765 (Edit → Fill on an untouched layer painted 1 pixel of stale
//   compositor content instead of filling the layer; `fill_with_color`
//   now calls `ensure_layer_full_size` so the fresh 1x1 texture is
//   expanded to the doc union before the fill shader runs).
// - #766 (Clouds / Smoke / Fibers / Voronoi passed source alpha through
//   from `texture(u_tex, v_uv)`, so on a transparent layer the shader
//   wrote cloud RGB but the pixels stayed invisible — the four
//   generator shaders now write full alpha so the pattern shows on an
//   empty layer as any user would expect from a generator).
// - #767 (Selecting Brush while a text layer was active fired
//   `prewarmStroke`, whose `ensure_layer_full_size` re-origined the
//   layer to (0, 0) — the next text property change then re-anchored
//   the type to the canvas corner. `shouldPrewarmStroke` now refuses
//   text layers so the anchor invariant survives a Brush tool click).
// - #768 (No pixel-writing entry point checked layer type — a Bucket
//   Fill or Fill-menu click on a group would write an invisible
//   texture + a history row, and paint on a text layer was wiped by
//   the next re-render. `handleToolDown` and the menu writers now
//   route through `guardPixelWrite` and refuse both types with a toast).

const BLACK = { r: 0, g: 0, b: 0 };

/** Read the top of the undo stack's label (most recent history entry). */
async function lastHistoryLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    const stack = store.getState().undoStack;
    const top = stack[stack.length - 1];
    return top?.label ?? null;
  });
}

async function undoStackSize(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: unknown[] };
    };
    return store.getState().undoStack.length;
  });
}

async function activeLayer(page: Page): Promise<{ id: string; type: string; x: number; y: number; width?: number; height?: number }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; type: string; x: number; y: number; width?: number; height?: number }> } };
    };
    const s = store.getState();
    const l = s.document.layers.find((l) => l.id === s.document.activeLayerId)!;
    return { id: l.id, type: l.type, x: l.x, y: l.y, width: l.width, height: l.height };
  });
}

async function clickEditMenuFill(page: Page): Promise<void> {
  // Open Edit menu then click the Fill item.
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// #765 — Edit → Fill on a fresh 1x1 layer fills the whole document, not one
// pixel of stale compositor content.
// ---------------------------------------------------------------------------

test.describe('#765 — Edit → Fill on an untouched layer', () => {
  test('paints the whole doc in the foreground colour, not one stale pixel', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar is hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    // Start with a transparent-background document so Layer 1 is a true
    // empty raster (GPU texture still the lazy 1x1 placeholder).
    await createDocument(page, 200, 150, true);
    await setForegroundColor(page, BLACK.r, BLACK.g, BLACK.b);

    // Pre-fix: the fill would run on the 1x1 texture and no pixel of the
    // real canvas would flip to black.
    const before = await getPixelAt(page, 100, 75);
    expect(before.a).toBe(0);

    await clickEditMenuFill(page);
    // Sample a few doc-space pixels — all should be foreground colour.
    const centre = await getPixelAt(page, 100, 75);
    const corner = await getPixelAt(page, 5, 5);
    const opposite = await getPixelAt(page, 190, 140);
    for (const p of [centre, corner, opposite]) {
      expect(p.a).toBeGreaterThan(200);
      expect(p.r).toBeLessThan(20);
      expect(p.g).toBeLessThan(20);
      expect(p.b).toBeLessThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// #766 — Clouds on an empty layer produces visible output.
// ---------------------------------------------------------------------------

test.describe('#766 — generator filters on a transparent layer', () => {
  test('Clouds fills alpha across a fresh Layer 1', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar is hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 150, true);

    // Pre-fix: the clouds shader wrote cloud RGB but preserved the
    // (empty) source alpha, leaving every pixel transparent.
    await page.getByRole('button', { name: /^Filter$/ }).click();
    await page.getByRole('menuitem', { name: /^Clouds\.\.\.$/ }).click();
    await page.waitForTimeout(250);
    // Filter dialog opens with a live preview; click Apply to commit.
    await page.getByRole('button', { name: /^Apply$/ }).click();
    await page.waitForTimeout(300);

    // Sample several pixels — Clouds should have produced opaque output
    // across the whole layer. A pre-fix run would have alpha 0 everywhere.
    const samples = [
      await getPixelAt(page, 40, 30),
      await getPixelAt(page, 100, 75),
      await getPixelAt(page, 170, 120),
    ];
    for (const p of samples) {
      expect(p.a).toBeGreaterThan(200);
    }
  });
});

// ---------------------------------------------------------------------------
// #767 — Switching to Brush while a text layer is active does not re-origin
// the layer to (0, 0).
// ---------------------------------------------------------------------------

test.describe('#767 — Brush prewarm on a text layer', () => {
  test('selecting Brush does not teleport the text anchor to (0, 0)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'text tool requires keyboard input');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // Place a text layer at (100, 200) via the Text tool.
    await selectTool(page, 'text');
    const clickPos = await docToScreen(page, 100, 200);
    await page.mouse.click(clickPos.x, clickPos.y);
    await page.waitForTimeout(120);
    await page.keyboard.type('HELLO');
    await page.waitForTimeout(80);
    // Commit by switching to Move.
    await selectTool(page, 'move');
    await page.waitForTimeout(150);

    const beforeBrush = await activeLayer(page);
    expect(beforeBrush.type).toBe('text');
    // The text anchor lives near the click point — not at (0, 0).
    expect(Math.abs(beforeBrush.x)).toBeGreaterThan(20);
    expect(Math.abs(beforeBrush.y)).toBeGreaterThan(20);

    // Pre-fix: this Brush selection would fire prewarmStroke, whose
    // ensure_layer_full_size re-origined the layer to (0, 0).
    await selectTool(page, 'brush');
    await page.waitForTimeout(200);

    const afterBrush = await activeLayer(page);
    expect(afterBrush.type).toBe('text');
    // The layer's origin should not have moved.
    expect(afterBrush.x).toBe(beforeBrush.x);
    expect(afterBrush.y).toBe(beforeBrush.y);
  });
});

// ---------------------------------------------------------------------------
// #768 — Pixel writers refuse group/text layers instead of silently pushing
// history rows for invisible or soon-wiped writes.
// ---------------------------------------------------------------------------

test.describe('#768 — layer-type guards at pixel writes', () => {
  test('Bucket Fill on a group is refused (no history row, no toast on raster)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel is hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 150, true);

    // Create a group via the panel button and activate it.
    await addLayer(page);
    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const st = await getEditorState(page);
    const group = st.document.layers.find((l) => (l as unknown as { type: string }).type === 'group' && l.name !== 'Root Group')
      ?? st.document.layers.find((l) => (l as unknown as { type: string }).type === 'group');
    expect(group).toBeTruthy();
    await page.locator(`[data-layer-id="${group!.id}"]`).click();
    await page.waitForTimeout(120);

    const historyBefore = await undoStackSize(page);

    await setForegroundColor(page, BLACK.r, BLACK.g, BLACK.b);
    await selectTool(page, 'fill');
    const centre = await docToScreen(page, 100, 75);
    await page.mouse.click(centre.x, centre.y);
    await page.waitForTimeout(200);

    // Pre-fix: this click would have pushed a "Bucket Fill" row on the
    // group even though the compositor renders nothing from the group's
    // own texture.
    const historyAfter = await undoStackSize(page);
    expect(historyAfter).toBe(historyBefore);
    const label = await lastHistoryLabel(page);
    expect(label).not.toBe('Bucket Fill');
  });

  test('Edit → Fill on a group is refused (no history row)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar is hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 150, true);

    await addLayer(page);
    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const st = await getEditorState(page);
    const group = st.document.layers.find((l) => (l as unknown as { type: string }).type === 'group' && l.name !== 'Root Group')
      ?? st.document.layers.find((l) => (l as unknown as { type: string }).type === 'group');
    expect(group).toBeTruthy();
    await page.locator(`[data-layer-id="${group!.id}"]`).click();
    await page.waitForTimeout(120);

    const historyBefore = await undoStackSize(page);
    await setForegroundColor(page, BLACK.r, BLACK.g, BLACK.b);
    await clickEditMenuFill(page);
    const historyAfter = await undoStackSize(page);
    expect(historyAfter).toBe(historyBefore);
    const label = await lastHistoryLabel(page);
    expect(label).not.toBe('Fill');
  });
});
