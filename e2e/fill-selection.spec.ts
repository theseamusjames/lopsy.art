import { test, expect, type Page } from '@playwright/test';
import {
  createDocument,
  waitForStore,
  getPixelAt,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        cx;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function drawStroke(
  page: Page,
  fromDoc: { x: number; y: number },
  toDoc: { x: number; y: number },
  steps = 10,
) {
  const start = await docToScreen(page, fromDoc.x, fromDoc.y);
  const end = await docToScreen(page, toDoc.x, toDoc.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function setUIState(page: Page, setter: string, value: unknown) {
  await page.evaluate(
    ({ setter, value }) => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => Record<string, (v: unknown) => void>;
      };
      store.getState()[setter]!(value);
    },
    { setter, value },
  );
}

async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    const doc = state.document as {
      width: number;
      height: number;
      layers: Array<{
        id: string;
        name: string;
        visible: boolean;
        opacity: number;
        x: number;
        y: number;
      }>;
      layerOrder: string[];
      activeLayerId: string;
    };
    return {
      document: doc,
      selection: state.selection as {
        active: boolean;
        bounds: { x: number; y: number; width: number; height: number } | null;
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

// ===========================================================================
// Fill Tool with Selection (#63)
// ===========================================================================

test.describe('Fill tool with selection (#63)', () => {
  test('bucket fill is restricted to active selection marquee', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // 1. Create a rectangular selection in the center (50,50 to 150,150)
    await page.keyboard.press('m');
    await drawStroke(page, { x: 50, y: 50 }, { x: 150, y: 150 }, 5);

    const selState = await getEditorState(page);
    expect(selState.selection.active).toBe(true);

    // 2. Set fill tool active with bright red
    await page.keyboard.press('g');
    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });

    // 3. Click inside the selection to fill
    await clickAtDoc(page, 100, 100);

    // Wait for fill to process
    await page.waitForTimeout(300);

    // 4. Screenshot for visual debugging
    await page.screenshot({ path: 'test-results/screenshots/fill-within-selection.png' });

    // 5. Verify: pixel inside selection should be the fill color (red)
    const insidePixel = await getPixelAt(page, 100, 100);
    expect(insidePixel.r).toBe(255);
    expect(insidePixel.a).toBe(255);

    // 6. Verify: pixel outside selection should be unchanged (transparent)
    const outsidePixel = await getPixelAt(page, 10, 10);
    expect(outsidePixel.a).toBe(0);

    // Also check outside on the other side
    const outsidePixel2 = await getPixelAt(page, 190, 190);
    expect(outsidePixel2.a).toBe(0);
  });

  test('fill tool does not bleed outside selection bounds', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Create a small selection in the top-left corner (10,10 to 60,60)
    await page.keyboard.press('m');
    await drawStroke(page, { x: 10, y: 10 }, { x: 60, y: 60 }, 5);

    const selState = await getEditorState(page);
    expect(selState.selection.active).toBe(true);

    // Fill with green
    await page.keyboard.press('g');
    await setUIState(page, 'setForegroundColor', { r: 0, g: 255, b: 0, a: 1 });
    await clickAtDoc(page, 35, 35);
    await page.waitForTimeout(300);

    // Inside selection should be green
    const insidePixel = await getPixelAt(page, 35, 35);
    expect(insidePixel.g).toBe(255);
    expect(insidePixel.a).toBe(255);

    // Center of canvas (well outside selection) should be transparent
    const centerPixel = await getPixelAt(page, 100, 100);
    expect(centerPixel.a).toBe(0);

    // Bottom-right corner should be transparent
    const cornerPixel = await getPixelAt(page, 190, 190);
    expect(cornerPixel.a).toBe(0);
  });

  test('fill outside selection does not affect pixels outside selection', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Create a selection in the center
    await page.keyboard.press('m');
    await drawStroke(page, { x: 50, y: 50 }, { x: 150, y: 150 }, 5);

    const selState = await getEditorState(page);
    expect(selState.selection.active).toBe(true);

    // Fill tool with blue, click OUTSIDE the selection.
    // On a blank canvas the flood fill matches all transparent pixels,
    // so the fill mask covers everything. After intersection with the
    // selection mask, only the selection area should receive color.
    await page.keyboard.press('g');
    await setUIState(page, 'setForegroundColor', { r: 0, g: 0, b: 255, a: 1 });
    await clickAtDoc(page, 10, 10);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'test-results/screenshots/fill-outside-selection.png' });

    // Outside the selection should remain transparent
    const outsidePixel = await getPixelAt(page, 10, 10);
    expect(outsidePixel.a).toBe(0);

    // Inside the selection may be filled (flood fill matched the color)
    // The key invariant: pixels outside the selection are never affected
    const cornerPixel = await getPixelAt(page, 190, 190);
    expect(cornerPixel.a).toBe(0);
  });
});
