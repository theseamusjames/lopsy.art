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
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('text');
  });
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
    const textLayers = doc.layers.filter((l) => l.type === 'text');
    expect(textLayers.length).toBe(1);
    expect(textLayers[0]!.text).toBe('Hello World');
    expect(textLayers[0]!.visible).toBe(true); // Visible after commit
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

  test('area text layer stores width after commit', async ({ page }) => {
    await dragAtDoc(page, { x: 100, y: 100 }, { x: 400, y: 200 });
    await page.keyboard.type('Area text content');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);

    const doc = await getEditorDoc(page);
    const textLayers = doc.layers.filter((l) => l.type === 'text');
    expect(textLayers.length).toBe(1);
    expect(textLayers[0]!.width).not.toBeNull();
    expect(textLayers[0]!.text).toBe('Area text content');
  });

  test('clicking on existing text layer enters re-edit mode', async ({ page }) => {
    // Create and commit text at a known position
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Existing text');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);

    // Now click on the text layer location to re-edit
    await clickAtDoc(page, 210, 210);
    await page.waitForTimeout(100);

    const editing = await getTextEditing(page) as { text: string; isNew: boolean } | null;
    expect(editing).not.toBeNull();
    expect(editing!.text).toBe('Existing text');
    expect(editing!.isNew).toBe(false);
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
    const textLayers = doc.layers.filter((l) => l.type === 'text');
    expect(textLayers.length).toBe(0);
  });

  test('text layer has pixel data after commit', async ({ page }) => {
    await clickAtDoc(page, 100, 100);
    await page.keyboard.type('Pixel test');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    // Check that the text layer has pixel data uploaded
    const hasPixels = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }> };
        };
      };
      const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
        get: (id: string) => ImageData | undefined;
      };
      const state = store.getState();
      const textLayer = state.document.layers.find((l) => l.type === 'text');
      if (!textLayer) return false;
      const data = pixelData.get(textLayer.id);
      if (!data) return false;
      // Check if any pixel has non-zero alpha (text was rendered)
      for (let i = 3; i < data.data.length; i += 4) {
        if ((data.data[i] ?? 0) > 0) return true;
      }
      return false;
    });
    expect(hasPixels).toBe(true);
  });
});
