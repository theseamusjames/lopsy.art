// Regression tests for #233 — text tool failing after a long sequence of
// operations. The two scenarios cited in the issue thread now both work in
// the current codebase (likely closed by #228's text rasterization rewrite
// and the move-tool float commit path), so these tests guard against
// re-regression.
//   A) Two consecutive text layers ("WINTER" → move tool to commit → "JAZZ").
//      The bug report: JAZZ layer was created but had no rasterized content.
//   B) Tool-switch shortcut works after a polygon-shape transform overlay.
import { test, expect } from '@playwright/test';
import {
  createDocument,
  setForegroundColor,
  selectTool,
  docToScreen,
  waitForStore,
} from './helpers';

async function readActiveLayerOpaqueCount(page: import('@playwright/test').Page, layerId: string) {
  return page.evaluate(async (id) => {
    const readFn = (window as unknown as {
      __readLayerPixels: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    }).__readLayerPixels;
    const r = await readFn(id);
    if (!r || r.width === 0) return 0;
    let opaqueCount = 0;
    for (let i = 3; i < r.pixels.length; i += 4) if (r.pixels[i]! > 0) opaqueCount++;
    return opaqueCount;
  }, layerId);
}

test('issue #233 (A) — second text after move-tool commit still rasterizes content', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 1100, true);

  // First text — WINTER.
  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);
  await setForegroundColor(page, 255, 255, 255);
  await selectTool(page, 'text');
  const w1 = await docToScreen(page, 400, 250);
  await page.mouse.click(w1.x, w1.y);
  await page.waitForTimeout(200);
  await page.keyboard.type('WINTER');
  await page.waitForTimeout(200);
  // Switch to move tool via toolbox button — keyboard 'v' would be typed
  // into the text editor (textEditing intercepts all keystrokes). The text
  // tool's onDeactivate runs commitTextEditing on the way out.
  await page.locator('[data-tool-id="move"]').click();
  await page.waitForTimeout(300);

  const winterLayerId = await page.evaluate(() => {
    const store = (window as unknown as { __editorStore: { getState: () => { document: { layers: Array<{ id: string; name: string }> } } } }).__editorStore.getState();
    return store.document.layers.find((l) => l.name === 'Text 4')?.id ?? null;
  });
  expect(winterLayerId).not.toBeNull();
  const winterOpaque = await readActiveLayerOpaqueCount(page, winterLayerId!);
  expect(winterOpaque).toBeGreaterThan(50);

  // Second text — JAZZ near the WINTER bounds, where a stale transform
  // overlay would have a real chance to intercept us if the bug regressed.
  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);
  await selectTool(page, 'text');
  await setForegroundColor(page, 0, 200, 200);
  const w2 = await docToScreen(page, 400, 380);
  await page.mouse.click(w2.x, w2.y);
  await page.waitForTimeout(150);
  await page.keyboard.type('JAZZ');
  await page.waitForTimeout(200);
  await page.locator('[data-tool-id="move"]').click();
  await page.waitForTimeout(300);

  const jazzLayerId = await page.evaluate(() => {
    const store = (window as unknown as { __editorStore: { getState: () => { document: { layers: Array<{ id: string; name: string }> } } } }).__editorStore.getState();
    const text = store.document.layers.filter((l) => l.name.startsWith('Text'));
    return text.find((l) => l.name !== 'Text 4')?.id ?? null;
  });
  expect(jazzLayerId).not.toBeNull();
  const jazzOpaque = await readActiveLayerOpaqueCount(page, jazzLayerId!);
  expect(jazzOpaque).toBeGreaterThan(50);
});

test('issue #233 (B) — t shortcut switches to text tool after a polygon-shape transform overlay', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, true);

  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);

  // Draw a polygon shape (the issue cites this as the trigger sequence).
  await selectTool(page, 'shape');
  await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('polygon');
  const sStart = await docToScreen(page, 200, 200);
  const sEnd = await docToScreen(page, 400, 400);
  await page.mouse.move(sStart.x, sStart.y);
  await page.mouse.down();
  await page.mouse.move(sEnd.x, sEnd.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Press 't' to switch to the text tool. The bug report's first scenario
  // says this silently fails after a polygon shape leaves a transform
  // overlay around it.
  await page.keyboard.press('t');
  await page.waitForTimeout(80);

  const activeTool = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
  expect(activeTool).toBe('text');
});
