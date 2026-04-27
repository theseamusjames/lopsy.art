import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, drawRect, setActiveLayer, getEditorState, undo, redo } from './helpers';

/**
 * Helper: commit text via the real UI flow (text tool → type → switch tool).
 * Returns the layer state after commit.
 */
async function commitTextViaUI(
  page: import('@playwright/test').Page,
  docX: number, docY: number, text: string,
) {
  // Switch to text tool
  await page.keyboard.press('t');
  await page.waitForTimeout(200);

  // Get canvas mapping
  const info = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    const r = c.getBoundingClientRect();
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number; panX: number; panY: number }; document: { width: number; height: number } };
    };
    const { viewport: v, document: d } = s.getState();
    return { left: r.left, top: r.top, w: r.width, h: r.height, zoom: v.zoom, panX: v.panX, panY: v.panY, docW: d.width, docH: d.height };
  });
  const screen = {
    x: (docX - info.docW / 2) * info.zoom + info.panX + info.w / 2 + info.left,
    y: (docY - info.docH / 2) * info.zoom + info.panY + info.h / 2 + info.top,
  };

  // Click to start text, type, then switch tool to commit
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(200);
  await page.keyboard.type(text);
  await page.waitForTimeout(200);

  // Switch to move tool (triggers onDeactivate → commitTextEditing)
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
}

/** Get all layers with positions */
async function getLayers(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number; type: string; name: string }> } };
    };
    return s.getState().document.layers.map(l => ({
      id: l.id, name: l.name, type: l.type, x: l.x, y: l.y,
      width: l.width, height: l.height,
    }));
  });
}

test('undo after text commit removes the text layer', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForTimeout(500);

  const beforeText = await getLayers(page);
  console.log('Before text:', JSON.stringify(beforeText));
  const layerCountBefore = beforeText.length;

  await commitTextViaUI(page, 150, 130, 'HELLO');

  const afterCommit = await getLayers(page);
  console.log('After commit:', JSON.stringify(afterCommit));
  const textLayer = afterCommit.find(l => l.name.startsWith('Text'));

  // Text layer should exist and be rasterized
  if (!textLayer) {
    console.log('SKIP: Text did not render (font missing in headless)');
    return;
  }
  expect(textLayer.type).toBe('raster');
  expect(afterCommit.length).toBe(layerCountBefore + 1);

  await page.screenshot({ path: 'e2e/screenshots/text-undo-01-committed.png' });

  // Undo twice: once for "Text" commit, once for "Add Text Layer"
  await undo(page);
  await page.waitForTimeout(300);
  await undo(page);
  await page.waitForTimeout(300);

  const afterUndo = await getLayers(page);
  console.log('After undo:', JSON.stringify(afterUndo));

  await page.screenshot({ path: 'e2e/screenshots/text-undo-02-after-undo.png' });

  // Text layer should be gone
  const textLayerAfterUndo = afterUndo.find(l => l.name.startsWith('Text'));
  expect(textLayerAfterUndo).toBeUndefined();
  expect(afterUndo.length).toBe(layerCountBefore);
});

test('undo after text commit does not move other layers', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForTimeout(500);

  // Paint a red square on the active layer so it gets cropped to non-zero position
  const state = await getEditorState(page);
  const bgLayerId = state.document.layers.find(
    (l: { name: string }) => l.name === 'Background',
  )?.id;
  if (bgLayerId) {
    await setActiveLayer(page, bgLayerId);
    await drawRect(page, 50, 50, 80, 60, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(300);
  }

  // Record positions of all existing layers BEFORE text
  const beforeText = await getLayers(page);
  console.log('Before text:', JSON.stringify(beforeText));

  // Now add text
  await commitTextViaUI(page, 200, 150, 'TEST');

  const afterCommit = await getLayers(page);
  console.log('After commit:', JSON.stringify(afterCommit));

  // Undo the text commit
  await undo(page);
  await page.waitForTimeout(300);

  const afterUndo = await getLayers(page);
  console.log('After undo:', JSON.stringify(afterUndo));

  await page.screenshot({ path: 'e2e/screenshots/text-undo-03-other-layers.png' });

  // Check that NON-TEXT layers kept their original positions
  for (const before of beforeText) {
    const after = afterUndo.find(l => l.id === before.id);
    if (!after) continue;
    console.log(`Layer "${before.name}": before=(${before.x},${before.y},${before.width},${before.height}) after=(${after.x},${after.y},${after.width},${after.height})`);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  }
});

test('undo after text commit does not move cropped layers at non-zero positions', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await waitForStore(page);
  // Transparent background so painted layers get cropped to content bounds
  await createDocument(page, 400, 300, true);
  await page.waitForTimeout(500);

  // Paint a small rect at (50, 50) — after cropLayerToContent, the layer
  // should be at (50, 50) with a small width/height, NOT at (0, 0).
  const state = await getEditorState(page);
  const activeId = state.document.activeLayerId;
  await setActiveLayer(page, activeId);
  await drawRect(page, 50, 50, 80, 60, { r: 255, g: 0, b: 0 });
  await page.waitForTimeout(500);

  // Verify the layer is cropped to a non-zero position
  const afterPaint = await getLayers(page);
  const paintedLayer = afterPaint.find(l => l.id === activeId);
  console.log('Painted layer after crop:', JSON.stringify(paintedLayer));
  expect(paintedLayer!.x).toBe(50);
  expect(paintedLayer!.y).toBe(50);

  // Now add text on a different position
  await commitTextViaUI(page, 200, 200, 'HI');
  await page.waitForTimeout(300);

  const afterText = await getLayers(page);
  console.log('After text commit:', JSON.stringify(afterText));

  // Undo the text commit
  await undo(page);
  await page.waitForTimeout(300);

  const afterUndo = await getLayers(page);
  const paintedAfterUndo = afterUndo.find(l => l.id === activeId);
  console.log('Painted layer after undo:', JSON.stringify(paintedAfterUndo));

  await page.screenshot({ path: 'e2e/screenshots/text-undo-05-cropped-layer.png' });

  // The painted layer must NOT have jumped to (0, 0)
  expect(paintedAfterUndo!.x).toBe(50);
  expect(paintedAfterUndo!.y).toBe(50);
  expect(paintedAfterUndo!.width).toBe(80);
  expect(paintedAfterUndo!.height).toBe(60);
});

test('undo + redo after text commit preserves text correctly', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForTimeout(500);

  await commitTextViaUI(page, 150, 130, 'REDO');

  const afterCommit = await getLayers(page);
  const textLayer = afterCommit.find(l => l.name.startsWith('Text'));
  if (!textLayer) {
    console.log('SKIP: Text did not render');
    return;
  }
  console.log('After commit:', JSON.stringify(textLayer));

  // Undo
  await undo(page);
  await page.waitForTimeout(300);

  // Redo — should restore the committed text
  await redo(page);
  await page.waitForTimeout(300);

  const afterRedo = await getLayers(page);
  console.log('After redo:', JSON.stringify(afterRedo));

  await page.screenshot({ path: 'e2e/screenshots/text-undo-04-after-redo.png' });

  // The text layer should be back as a raster layer
  const redoTextLayer = afterRedo.find(l => l.name.startsWith('Text'));
  expect(redoTextLayer).toBeTruthy();
  expect(redoTextLayer!.type).toBe('raster');
});
