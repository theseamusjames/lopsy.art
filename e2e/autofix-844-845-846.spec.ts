import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  drawRect,
  setActiveLayer,
  setToolOption,
  addLayer,
  undo,
} from './helpers';

// Coverage for the nightly QA batch of Text-tool bugs:
// - #844 (Cmd+A while editing text also selects every layer in the Layers
//   panel, so the next nudge/drag moves the whole document)
// - #845 (a multi-line point-text layer's hit-test width used the total
//   character count across ALL lines instead of the longest line, so a
//   click far to the right of a short multi-line layer reopened it for
//   editing instead of starting a new layer)
// - #846 (typing a value into the text Size box — or using its arrow keys
//   or double-click-reset — restyled a committed text layer without
//   pushing a history entry, so the next undo popped the original text
//   commit instead of the resize)

interface TestLayer {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  fontSize?: number;
  visible: boolean;
}

async function getLayers(page: Page): Promise<TestLayer[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: TestLayer[] } };
    };
    return store.getState().document.layers.map((l) => ({
      id: l.id, name: l.name, type: l.type, x: l.x, y: l.y,
      text: l.text, fontSize: l.fontSize, visible: l.visible,
    }));
  });
}

async function getSelectedLayerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { selectedLayerIds: string[] } };
    };
    return store.getState().document.selectedLayerIds;
  });
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(150);
}

async function commitText(page: Page) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
}

test.describe('#844 — Cmd+A while editing text must not select every layer', () => {
  test('editing text, Cmd+A, retype, commit, then Move+ArrowRight only moves the text layer', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    // "Layer 1 with a filled block" — an extra raster layer with content at
    // a known, non-zero position so we can prove it never moves.
    const filledLayerId = await addLayer(page);
    await drawRect(page, 60, 60, 40, 40, { r: 0, g: 128, b: 255 });
    await page.waitForTimeout(200);

    const before = await getLayers(page);
    const bgLayer = before.find((l) => l.name === 'Background')!;
    const filledLayer = before.find((l) => l.id === filledLayerId)!;

    // Text tool, size 40, click (220,180), type HI, Tab.
    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 40);
    await clickAtDoc(page, 220, 180);
    await page.keyboard.type('HI');
    await commitText(page);

    const afterHi = await getLayers(page);
    const textLayer = afterHi.find((l) => l.type === 'text');
    expect(textLayer, 'text layer should have committed').toBeTruthy();

    // Click inside "HI" to re-enter edit mode. The committed layer's origin
    // snaps a few px from the click point (glyph metrics), so click well
    // inside its estimated box rather than right at the corner.
    await clickAtDoc(page, 230, 200);
    await page.waitForTimeout(150);

    // TextInputSink documents (see its handleBlur comment) that a canvas
    // click transiently moves DOM focus to <body> before its own
    // setTimeout(0) refocuses the hidden input sink — the exact window
    // LayerPanel's own keydown listener must not be fooled by. Force that
    // documented transition and fire the real Cmd+A keydown inside it, in
    // one synchronous tick, so the test isn't racing a 0ms timer.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true,
      }));
    });

    // Give the text editor's own Cmd+A (useKeyboardShortcuts) a moment,
    // then type the replacement and commit.
    await page.waitForTimeout(50);
    await page.keyboard.type('ZZ');
    await commitText(page);

    const afterZz = await getLayers(page);
    const zzLayer = afterZz.find((l) => l.id === textLayer!.id)!;
    expect(zzLayer.text).toBe('ZZ');

    // The bug: Cmd+A while editing also puts every layer into
    // document.selectedLayerIds via LayerPanel's own keydown listener.
    const selectedAfterCommit = await getSelectedLayerIds(page);
    expect(
      selectedAfterCommit.includes(bgLayer.id) || selectedAfterCommit.includes(filledLayer.id),
    ).toBe(false);

    // Move tool, nudge right once — only the text layer should move.
    await page.keyboard.press('v');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);

    const afterNudge = await getLayers(page);
    const bgAfter = afterNudge.find((l) => l.id === bgLayer.id)!;
    const filledAfter = afterNudge.find((l) => l.id === filledLayer.id)!;
    const zzAfter = afterNudge.find((l) => l.id === zzLayer.id)!;

    expect(zzAfter.x).toBe(zzLayer.x + 1);
    expect(bgAfter.x).toBe(bgLayer.x);
    expect(bgAfter.y).toBe(bgLayer.y);
    expect(filledAfter.x).toBe(filledLayer.x);
    expect(filledAfter.y).toBe(filledLayer.y);
  });
});

test.describe('#845 — multi-line text hit-test uses the longest line, not total characters', () => {
  test('clicking far right of a short multi-line layer creates a new layer instead of appending to it', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 24);
    await clickAtDoc(page, 40, 200);
    await page.keyboard.type('ITEM ONE');
    await page.keyboard.press('Enter');
    await page.keyboard.type('ITEM TWO');
    await page.keyboard.press('Enter');
    await page.keyboard.type('ITEM THREE');
    await commitText(page);

    const afterMenu = await getLayers(page);
    const menuLayer = afterMenu.find((l) => l.type === 'text');
    expect(menuLayer, 'multi-line menu layer should have committed').toBeTruthy();
    expect(menuLayer!.text).toBe('ITEM ONE\nITEM TWO\nITEM THREE');

    // Select the Background layer so nothing text-related is "active" —
    // matches the repro's "no text layer active" precondition.
    const bgLayer = afterMenu.find((l) => l.name === 'Background');
    if (bgLayer) await setActiveLayer(page, bgLayer.id);

    // Click ~220px right of the glyphs (which end around x=180 at size 24).
    await clickAtDoc(page, 400, 240);
    await page.waitForTimeout(150);
    await page.keyboard.type('NEW');
    await commitText(page);

    const afterNew = await getLayers(page);

    // The original multi-line layer must be untouched.
    const menuAfter = afterNew.find((l) => l.id === menuLayer!.id)!;
    expect(menuAfter.text).toBe('ITEM ONE\nITEM TWO\nITEM THREE');

    // A separate new text layer with "NEW" must exist.
    const newLayer = afterNew.find((l) => l.type === 'text' && l.id !== menuLayer!.id);
    expect(newLayer, 'a new separate text layer should have been created').toBeTruthy();
    expect(newLayer!.text).toBe('NEW');
  });
});

test.describe('#846 — typed Size value pushes history so undo restores the pre-resize state', () => {
  test('typing a new Size into the value box, Enter, then Cmd+Z restores the original size and keeps the text', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 40);
    await clickAtDoc(page, 40, 40);
    await page.keyboard.type('HELLO');
    await commitText(page);

    const afterCommit = await getLayers(page);
    const textLayer = afterCommit.find((l) => l.type === 'text');
    expect(textLayer, 'HELLO should have committed').toBeTruthy();
    expect(textLayer!.text).toBe('HELLO');
    expect(textLayer!.fontSize).toBe(40);

    // With HELLO still committed and selected (not editing), type into the
    // Size VALUE BOX — not a drag — and commit with Enter.
    await setToolOption(page, 'Size', 90);

    const afterResize = await getLayers(page);
    const resized = afterResize.find((l) => l.id === textLayer!.id)!;
    expect(resized.fontSize).toBe(90);
    expect(resized.text).toBe('HELLO');

    await undo(page);
    await page.waitForTimeout(200);

    const afterUndo = await getLayers(page);
    const undone = afterUndo.find((l) => l.id === textLayer!.id);

    // Before the fix, the typed resize pushed no history entry, so this
    // undo popped the ORIGINAL "Text" commit instead — the layer would
    // still exist but with empty text at fontSize 40. The fix must instead
    // undo just the resize: HELLO back at its original size 40, text intact.
    expect(undone, 'the text layer must still exist after undo').toBeTruthy();
    expect(undone!.fontSize).toBe(40);
    expect(undone!.text).toBe('HELLO');
  });
});
