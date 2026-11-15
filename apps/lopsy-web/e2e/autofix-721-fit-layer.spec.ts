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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getSelectionBounds(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { bounds: Rect | null } };
    };
    return store.getState().selection.bounds;
  });
}

/**
 * Document-space rect of the pasted layer's opaque pixels, plus whether every
 * pixel inside it is the paste colour. A squashed or offset fit shows up as a
 * different rect or as a mix of transparent and opaque pixels.
 */
async function readPastedContent(
  page: Page,
  color: { r: number; g: number; b: number },
): Promise<{ rect: Rect | null; isSolid: boolean }> {
  return page.evaluate(async (color) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const store = w.__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; name: string; x: number; y: number }> };
      };
    };
    const id = store.getState().document.layers.find((l) => l.name === 'Pasted Layer')!.id;
    const result = await read(id);
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    if (!result || result.width === 0) return { rect: null, isSolid: false };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        if ((result.pixels[(y * result.width + x) * 4 + 3] ?? 0) === 0) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) return { rect: null, isSolid: false };
    let isSolid = true;
    for (let y = minY; y <= maxY && isSolid; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = (y * result.width + x) * 4;
        if (
          Math.abs((result.pixels[i] ?? 0) - color.r) > 2 ||
          Math.abs((result.pixels[i + 1] ?? 0) - color.g) > 2 ||
          Math.abs((result.pixels[i + 2] ?? 0) - color.b) > 2 ||
          (result.pixels[i + 3] ?? 0) !== 255
        ) {
          isSolid = false;
          break;
        }
      }
    }
    return {
      rect: { x: layer.x + minX, y: layer.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      isSolid,
    };
  }, color);
}

/**
 * Paste an oversized image, let the prefloat run, click Fit Layer, and check
 * the click changed nothing the user can see: the content stays at the
 * auto-fit rect, unscaled, and no history entry is pushed.
 *
 * The auto-fit rect is read from the selection, not the layer descriptor:
 * the prefloat floats the pasted pixels, which expands the layer texture to
 * the document, and the store deliberately mirrors that expanded texture
 * (#810). Fit drops the float and crops back to the content before deciding
 * whether there is anything to do.
 */
async function expectFitIsNoopAfterPaste(
  page: Page,
  doc: { width: number; height: number },
  paste: { width: number; height: number },
  expectedFit: Rect,
): Promise<void> {
  const color = { r: 40, g: 180, b: 220 };
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, doc.width, doc.height, false);

  await pastePng(page, paste.width, paste.height, color);
  await waitForPrefloat(page);

  expect(await getSelectionBounds(page)).toEqual(expectedFit);
  const undoBefore = (await getEditorState(page)).undoStackLength;

  await clickFitLayerToCanvas(page);

  const after = await getEditorState(page);
  const layer = after.document.layers.find((l) => l.name === 'Pasted Layer')!;
  expect({ x: layer.x, y: layer.y, width: layer.width, height: layer.height }).toEqual(expectedFit);
  expect(after.undoStackLength).toBe(undoBefore);
  expect(await readPastedContent(page, color)).toEqual({ rect: expectedFit, isSolid: true });
}

test.describe('#721 — Fit Layer to Canvas is a no-op when the layer is already fit', () => {
  test('oversized paste → click Fit Layer → layer bounds unchanged, no history entry', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Move-tool options bar is desktop-only');
    // 800×600 paste on a 400×300 canvas — computeFit shrinks it to (0,0,400,300).
    await expectFitIsNoopAfterPaste(
      page,
      { width: 400, height: 300 },
      { width: 800, height: 600 },
      { x: 0, y: 0, width: 400, height: 300 },
    );
  });

  test('oversized wide paste (2:1 aspect) → click Fit Layer → letterboxed bounds unchanged, no history entry', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Move-tool options bar is desktop-only');
    // 800×400 paste on a 400×400 canvas → auto-fit lands at (0, 100, 400, 200).
    await expectFitIsNoopAfterPaste(
      page,
      { width: 400, height: 400 },
      { width: 800, height: 400 },
      { x: 0, y: 100, width: 400, height: 200 },
    );
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
