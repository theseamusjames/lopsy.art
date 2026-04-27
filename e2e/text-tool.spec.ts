import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width = 400, height = 300) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
  );
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
}

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

async function selectTextTool(page: Page) {
  await page.keyboard.press('t');
}

async function getTextEditing(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { textEditing: unknown };
    };
    return store.getState().textEditing;
  });
}

async function getEditorDoc(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: Record<string, unknown> };
    };
    const doc = store.getState().document;
    return {
      layers: doc.layers as Array<{
        id: string;
        name: string;
        type: string;
        visible: boolean;
        x: number;
        y: number;
        text?: string;
        fontFamily?: string;
        fontSize?: number;
        width?: number | null;
      }>,
      activeLayerId: doc.activeLayerId as string,
    };
  });
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function dragAtDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Text tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page, 800, 600);
    await selectTextTool(page);
  });

  test('clicking canvas enters text editing mode and creates a text layer', async ({ page }) => {
    await clickAtDoc(page, 200, 200);

    const editing = await getTextEditing(page);
    expect(editing).not.toBeNull();

    const doc = await getEditorDoc(page);
    const textLayers = doc.layers.filter((l) => l.type === 'text');
    expect(textLayers.length).toBe(1);
    expect(textLayers[0]!.visible).toBe(true); // Visible during editing for live preview
  });

  test('typing text updates the editing state', async ({ page }) => {
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Hello');

    const editing = await getTextEditing(page) as { text: string; cursorPos: number } | null;
    expect(editing).not.toBeNull();
    expect(editing!.text).toBe('Hello');
    expect(editing!.cursorPos).toBe(5);
  });

  test('pressing Tab commits text to the layer', async ({ page }) => {
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Hello World');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);

    const editing = await getTextEditing(page);
    expect(editing).toBeNull();

    const doc = await getEditorDoc(page);
    // After commit, text layers are rasterized to type 'raster' but keep their "Text" name
    const rasterizedTextLayers = doc.layers.filter((l) => l.type === 'raster' && l.name.startsWith('Text'));
    expect(rasterizedTextLayers.length).toBe(1);
    expect(rasterizedTextLayers[0]!.visible).toBe(true);
  });

  test('pressing Escape cancels editing and removes the new layer', async ({ page }) => {
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Temp');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const editing = await getTextEditing(page);
    expect(editing).toBeNull();

    const doc = await getEditorDoc(page);
    const textLayers = doc.layers.filter((l) => l.type === 'text');
    expect(textLayers.length).toBe(0);
  });

  test('click-drag creates area text with width', async ({ page }) => {
    await dragAtDoc(page, { x: 100, y: 100 }, { x: 350, y: 250 });

    const editing = await getTextEditing(page) as { bounds: { width: number | null } } | null;
    expect(editing).not.toBeNull();
    expect(editing!.bounds.width).not.toBeNull();
    expect(editing!.bounds.width!).toBeGreaterThan(200);
  });

  test('area text layer is rasterized after commit', async ({ page }) => {
    await dragAtDoc(page, { x: 100, y: 100 }, { x: 400, y: 200 });
    await page.keyboard.type('Area text content');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);

    const doc = await getEditorDoc(page);
    // After commit, text layers are rasterized — type becomes 'raster'
    const rasterizedTextLayers = doc.layers.filter((l) => l.type === 'raster' && l.name.startsWith('Text'));
    expect(rasterizedTextLayers.length).toBe(1);
    // Rasterized layer covers the full document
    expect(rasterizedTextLayers[0]!.width).not.toBeNull();
  });

  test('clicking after commit starts a new text session (rasterized text cannot be re-edited)', async ({ page }) => {
    // Create and commit text at a known position
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Existing text');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);

    // Text is now rasterized — clicking at the same location starts a new text session
    await clickAtDoc(page, 210, 210);
    await page.waitForTimeout(100);

    const editing = await getTextEditing(page) as { text: string; isNew: boolean } | null;
    expect(editing).not.toBeNull();
    expect(editing!.isNew).toBe(true);
    expect(editing!.text).toBe('');
  });

  test('Enter key inserts a newline', async ({ page }) => {
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Line 1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Line 2');

    const editing = await getTextEditing(page) as { text: string } | null;
    expect(editing).not.toBeNull();
    expect(editing!.text).toBe('Line 1\nLine 2');
  });

  test('Backspace deletes character before cursor', async ({ page }) => {
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Backspace');

    const editing = await getTextEditing(page) as { text: string; cursorPos: number } | null;
    expect(editing!.text).toBe('Hell');
    expect(editing!.cursorPos).toBe(4);
  });

  test('committing empty text removes the new layer', async ({ page }) => {
    await clickAtDoc(page, 200, 200);
    // Don't type anything, just commit
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(100);

    const doc = await getEditorDoc(page);
    // No text or rasterized-text layers should exist
    const textLayers = doc.layers.filter((l) => l.name.startsWith('Text'));
    expect(textLayers.length).toBe(0);
  });

  test('text layer has pixel data after commit', async ({ page }) => {
    await clickAtDoc(page, 100, 100);
    await page.keyboard.type('Pixel test');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    // Check that the rasterized text layer has pixel data in the GPU texture
    const hasPixels = await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string; name: string }> };
        };
      };
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const state = store.getState();
      const textLayer = state.document.layers.find((l) => l.type === 'raster' && l.name.startsWith('Text'));
      if (!textLayer) return false;
      const result = await readFn(textLayer.id);
      if (!result || result.width === 0) return false;
      for (let i = 3; i < result.pixels.length; i += 4) {
        if ((result.pixels[i] ?? 0) > 0) return true;
      }
      return false;
    });
    expect(hasPixels).toBe(true);
  });
});
