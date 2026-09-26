import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, docToScreen } from './helpers';

// Regression coverage for #887: Dodge/Burn, Sponge, and Clone Stamp each
// pushed a phantom 'Eraser' history entry in addition to their own real
// entry, because the generic paint dispatch in useCanvasInteraction.ts
// pushed a fallback label for every paint tool that wasn't brush/pencil/
// spray — including tools that already push their own correctly-labeled
// entry from their own down-handler. Clone Stamp's alt-click source-set
// also pushed a bogus 'Eraser' even though no pixels changed.

async function openHistoryPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => {
        visiblePanels: Set<string>;
        togglePanel: (id: string) => void;
      };
    };
    const state = store.getState();
    if (!state.visiblePanels.has('history')) {
      state.togglePanel('history');
    }
  });
  await page.waitForTimeout(100);
  // The panel may have been docked into a group without becoming the
  // active tab — activate its tab explicitly if present.
  const tab = page.locator('[data-dock-tab="history"]');
  if (await tab.count() > 0) {
    await tab.click();
  }
  await page.locator('section[role="tabpanel"][aria-label="History"]').waitFor({ state: 'visible' });
}

/** Reads every rendered history row's label (including "Original" at index 0). */
async function getHistoryLabels(page: Page): Promise<string[]> {
  const panel = page.locator('section[role="tabpanel"][aria-label="History"]');
  const rows = panel.locator('button');
  const count = await rows.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    labels.push((await rows.nth(i).locator('span').nth(1).innerText()).trim());
  }
  return labels;
}

/** The history rows appended since `before` — i.e. what this gesture actually pushed. */
function newLabels(before: string[], after: string[]): string[] {
  return after.slice(before.length);
}

async function drawStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe('Paint tool history entries (#887)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'history panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await openHistoryPanel(page);
  });

  test('a dodge stroke pushes exactly one "Dodge" entry, no Eraser', async ({ page }) => {
    const before = await getHistoryLabels(page);

    await selectTool(page, 'dodge');
    await page.waitForTimeout(100);
    await drawStroke(page, { x: 100, y: 100 }, { x: 200, y: 100 });

    const after = await getHistoryLabels(page);
    expect(newLabels(before, after)).toEqual(['Dodge']);
  });

  test('a sponge stroke pushes exactly one "Desaturate" entry, no Eraser', async ({ page }) => {
    const before = await getHistoryLabels(page);

    await selectTool(page, 'sponge');
    await page.waitForTimeout(100);
    await drawStroke(page, { x: 100, y: 100 }, { x: 200, y: 100 });

    const after = await getHistoryLabels(page);
    // Sponge defaults to 'desaturate' mode.
    expect(newLabels(before, after)).toEqual(['Desaturate']);
  });

  test('clone stamp source-set click pushes nothing, and the following stroke pushes exactly one "Clone Stamp" entry', async ({ page }) => {
    const before = await getHistoryLabels(page);

    await selectTool(page, 'stamp');
    await page.waitForTimeout(100);

    // Alt-click to set the clone source — no pixels change, so history
    // must be untouched.
    const source = await docToScreen(page, 50, 50);
    await page.mouse.move(source.x, source.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForTimeout(150);

    const afterSourceSet = await getHistoryLabels(page);
    expect(newLabels(before, afterSourceSet)).toEqual([]);

    // Now stroke — this is the one real pixel-changing operation.
    await drawStroke(page, { x: 150, y: 150 }, { x: 200, y: 150 });

    const afterStroke = await getHistoryLabels(page);
    expect(newLabels(afterSourceSet, afterStroke)).toEqual(['Clone Stamp']);
  });

  test('a genuine eraser stroke still pushes exactly one "Eraser" entry', async ({ page }) => {
    // Paint something first so there's content to erase.
    await selectTool(page, 'brush');
    await page.waitForTimeout(100);
    await drawStroke(page, { x: 100, y: 100 }, { x: 200, y: 100 });

    const before = await getHistoryLabels(page);

    await selectTool(page, 'eraser');
    await page.waitForTimeout(100);
    await drawStroke(page, { x: 100, y: 100 }, { x: 200, y: 100 });

    const after = await getHistoryLabels(page);
    expect(newLabels(before, after)).toEqual(['Eraser']);
  });

  test('brush and pencil strokes are unaffected — one entry each', async ({ page }) => {
    const before = await getHistoryLabels(page);

    await selectTool(page, 'brush');
    await page.waitForTimeout(100);
    await drawStroke(page, { x: 60, y: 60 }, { x: 120, y: 60 });

    const afterBrush = await getHistoryLabels(page);
    expect(newLabels(before, afterBrush)).toEqual(['Brush']);

    await selectTool(page, 'pencil');
    await page.waitForTimeout(100);
    await drawStroke(page, { x: 60, y: 120 }, { x: 120, y: 120 });

    const afterPencil = await getHistoryLabels(page);
    expect(newLabels(afterBrush, afterPencil)).toEqual(['Pencil']);
  });
});
