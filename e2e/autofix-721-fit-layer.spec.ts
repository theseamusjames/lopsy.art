import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, getEditorState } from './helpers';

// Coverage for the remaining sub-bugs of #721 not addressed by the earlier
// bare-click-move fix:
//
//   1. Pasting an oversized image → auto-fit places the layer at the fit
//      position, but the paste-scheduled prefloat then calls
//      `expand_layer_to_doc_size`. That resets the layer descriptor's
//      origin (via `updateLayerPosition`) while leaving the descriptor's
//      width/height at the pre-expand content dims — a state the noop
//      check in `computeFitLayer` can't see through. Clicking "Fit Layer
//      to Canvas" then squashes the doc-sized texture into the smaller
//      layer bounds. Fix: drop the float + crop the texture back to the
//      selection bounds before running fit — so if the layer is already
//      fit, the button is a true no-op.
//
//   2. Cmd+A after a paste-driven alpha selection left the transform
//      overlay's handles pinned to the sub-canvas bounds because
//      `selectAll` (and `invertSelectionAction`) never called the paired
//      `setTransform(createTransformState(bounds))` every other selection
//      site uses. Fix: refresh the transform overlay in both.

/**
 * Paste a solid-color PNG at the given size via `pasteOrOpenBlob` (the
 * same entry point the real paste-event handler uses). Runs to completion
 * inside a single `page.evaluate` so the caller can chain state reads
 * without racing the paste's async decode.
 */
async function pastePng(
  page: Page,
  pngWidth: number,
  pngHeight: number,
  color: { r: number; g: number; b: number },
): Promise<void> {
  await page.evaluate(
    async ({ w, h, color }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
      ctx.fillRect(0, 0, w, h);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      const mod = await import('/src/app/paste-or-open.ts');
      await mod.pasteOrOpenBlob(blob, 'pasted');
    },
    { w: pngWidth, h: pngHeight, color },
  );
}

/**
 * Wait for the paste's rAF-scheduled `selectLayerAlpha` and the follow-up
 * `setTimeout(0)` prefloat to run. Once complete, the engine has a live
 * float and the JS layer descriptor has drifted from the content bounds —
 * this is the exact state that the fit-layer regression fires from.
 */
async function waitForPrefloat(page: Page): Promise<void> {
  // Two rAFs + a task tick is enough for `selectLayerAlpha` +
  // `schedulePrefloat(setTimeout 0)` to settle in every browser. Poll on
  // the selection because setSelection is the ground-truth signal that
  // selectLayerAlpha ran; `ui.transform` gets re-stamped by other flows
  // (tool switch, etc.) and is not a stable indicator here.
  await page.waitForFunction(
    () => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean; bounds: unknown } };
      };
      const s = store.getState().selection;
      return s.active && !!s.bounds;
    },
    null,
    { timeout: 2000 },
  );
  // Give the prefloat's setTimeout(0) a chance after the alpha selection lands.
  await page.waitForTimeout(50);
}

async function clickFitLayerToCanvas(page: Page): Promise<void> {
  // The Move-tool options bar ships a "Fit layer to canvas" IconButton
  // (see MoveOptions.tsx). Paste already switched us into Move.
  await page.locator('button[aria-label="Fit layer to canvas"]').click();
  await page.waitForTimeout(80);
}

test.describe('#721 — Fit Layer to Canvas is a no-op when the layer is already fit', () => {
  test('oversized paste → click Fit Layer → layer bounds unchanged, no history entry', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Move-tool options bar is desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // 800×600 paste on a 400×300 canvas — computeFit shrinks it to (0,0,400,300).
    await pastePng(page, 800, 600, { r: 220, g: 40, b: 60 });
    await waitForPrefloat(page);

    // Baseline: this is the state we expect the click NOT to alter.
    const before = await getEditorState(page);
    const pasted = before.document.layers.find((l) => l.name === 'Pasted Layer')!;
    // Auto-fit landed the content at (0, 0, 400, 300) for the 4:3 paste.
    expect(pasted.width).toBe(400);
    expect(pasted.height).toBe(300);
    const undoBefore = before.undoStackLength;

    await clickFitLayerToCanvas(page);

    const after = await getEditorState(page);
    const same = after.document.layers.find((l) => l.name === 'Pasted Layer')!;
    // The layer must not have been resized by the noop click.
    expect(same.width).toBe(pasted.width);
    expect(same.height).toBe(pasted.height);
    // And no history entry — `computeFitLayer` returned undefined, so
    // `pushHistory('Fit Layer to Canvas')` never ran.
    expect(after.undoStackLength).toBe(undoBefore);
  });

  test('oversized wide paste (2:1 aspect) → click Fit Layer → letterboxed bounds unchanged, no history entry', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Move-tool options bar is desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, false);

    // 800×400 paste on a 400×400 canvas → auto-fit lands at (0, 100, 400, 200).
    await pastePng(page, 800, 400, { r: 40, g: 180, b: 220 });
    await waitForPrefloat(page);

    const before = await getEditorState(page);
    const pasted = before.document.layers.find((l) => l.name === 'Pasted Layer')!;
    expect(pasted.width).toBe(400);
    expect(pasted.height).toBe(200);
    const undoBefore = before.undoStackLength;

    await clickFitLayerToCanvas(page);

    const after = await getEditorState(page);
    const same = after.document.layers.find((l) => l.name === 'Pasted Layer')!;
    expect(same.width).toBe(pasted.width);
    expect(same.height).toBe(pasted.height);
    expect(after.undoStackLength).toBe(undoBefore);
  });
});

test.describe('#721 — Cmd+A refreshes the transform overlay after a paste-driven alpha selection', () => {
  test('the ui-store transform bounds match the full canvas after Cmd+A', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard shortcuts targeted here are desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // Paste at a sub-canvas position so the alpha selection lands the
    // selection somewhere other than (0, 0, 400, 300).
    await pastePng(page, 800, 400, { r: 10, g: 200, b: 90 });
    await waitForPrefloat(page);

    // Seed a stale transform overlay whose bounds are the paste's
    // letterboxed selection (0, 50, 400, 200) — that's what
    // `selectLayerAlpha` set. We assert directly on the selection bounds
    // as the ground-truth "current selection is sub-canvas" fact, and
    // stamp `ui.transform` from those bounds so the pre-Cmd+A state
    // matches the real code path even if the ui.transform value has
    // since been overwritten by an unrelated tool-switch or interaction.
    const beforeSelection = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { bounds: { x: number; y: number; width: number; height: number } | null } };
      };
      return store.getState().selection.bounds;
    });
    expect(beforeSelection).not.toBeNull();
    expect(
      beforeSelection!.width === 400 && beforeSelection!.height === 300,
    ).toBe(false);

    // Cmd+A.
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+a' : 'Control+a');
    await page.waitForTimeout(60);

    // The overlay's bounds now cover the whole canvas — the missing
    // `setTransform` in `selectAll` used to leave them frozen at the
    // paste bounds. Read both the selection AND the transform: the fix
    // is precisely that these two now agree.
    const after = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { bounds: { x: number; y: number; width: number; height: number } | null } };
      };
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { transform: { originalBounds: { x: number; y: number; width: number; height: number } } | null };
      };
      return {
        selection: store.getState().selection.bounds,
        transform: ui.getState().transform?.originalBounds ?? null,
      };
    });
    expect(after.selection).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(after.transform).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });
});
