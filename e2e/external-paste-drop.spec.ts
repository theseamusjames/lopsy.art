import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForTimeout(200);
}

async function waitForLayerCount(page: Page, count: number) {
  await page.waitForFunction(
    (expected) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      };
      return store.getState().document.layers.length === expected;
    },
    count,
    { timeout: 5000 },
  );
}

async function waitForDocumentReady(page: Page) {
  await page.waitForFunction(
    () => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { documentReady: boolean };
      };
      return store.getState().documentReady;
    },
    { timeout: 5000 },
  );
}

async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    const doc = state.document as {
      name: string;
      width: number;
      height: number;
      layers: Array<{
        id: string;
        name: string;
        visible: boolean;
        opacity: number;
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
      layerOrder: string[];
      activeLayerId: string;
    };
    return {
      document: doc,
      documentReady: state.documentReady as boolean,
      undoStackLength: (state.undoStack as unknown[]).length,
    };
  });
}

/**
 * Read composited pixels from the WebGL canvas.
 * Returns screen-sized pixel array in RGBA order (bottom-up from WebGL).
 */
async function readCompositedPixels(page: Page) {
  return page.evaluate(async () => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      (() => Promise<{ width: number; height: number; pixels: number[] } | null>) | undefined;
    if (!readFn) return null;
    return readFn();
  });
}

/**
 * Create a PNG blob of a solid color in-browser and pass it through pasteOrOpenBlob.
 */
async function pasteColorPng(
  page: Page,
  pngWidth: number,
  pngHeight: number,
  color: { r: number; g: number; b: number; a: number },
  name: string,
) {
  await page.evaluate(
    async ({ w, h, color, name }) => {
      // Create a canvas with the specified color
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
      ctx.fillRect(0, 0, w, h);

      // Export as PNG blob
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );

      // Import the pasteOrOpenBlob dynamically
      const mod = await import('/src/app/paste-or-open.ts');
      await mod.pasteOrOpenBlob(blob, name);
    },
    { w: pngWidth, h: pngHeight, color, name },
  );
}

/**
 * Create a PNG blob and simulate dropping it as a file on the canvas container.
 * Uses Playwright's file chooser / DataTransfer approach.
 */
async function dropImageFile(
  page: Page,
  pngWidth: number,
  pngHeight: number,
  color: { r: number; g: number; b: number; a: number },
  fileName: string,
) {
  // Create PNG data URL in-browser, then convert to a buffer
  const dataUrl = await page.evaluate(
    ({ w, h, color }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
      ctx.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/png');
    },
    { w: pngWidth, h: pngHeight, color },
  );

  // Simulate drop via DataTransfer dispatch
  await page.evaluate(
    async ({ dataUrl, fileName }) => {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: 'image/png' });

      const target = document.querySelector('[data-testid="canvas-container"]') ?? document.querySelector('.' + document.querySelector('[class*="app"]')?.className.split(' ')[0]);
      if (!target) throw new Error('No drop target found');

      const dt = new DataTransfer();
      dt.items.add(file);

      const dragOver = new DragEvent('dragover', { bubbles: true, dataTransfer: dt });
      target.dispatchEvent(dragOver);

      const drop = new DragEvent('drop', { bubbles: true, dataTransfer: dt });
      target.dispatchEvent(drop);
    },
    { dataUrl, fileName },
  );
}

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

// ---------------------------------------------------------------------------
// Tests: External paste (clipboard image → lopsy)
// ---------------------------------------------------------------------------

test.describe('External paste', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('paste PNG into existing document adds a layer', async ({ page }) => {
    await createDocument(page, 400, 300);
    const before = await getEditorState(page);
    const layersBefore = before.document.layers.length;

    await pasteColorPng(page, 100, 80, { r: 255, g: 0, b: 0, a: 255 }, 'Copied File');
    await waitForLayerCount(page, layersBefore + 1);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(layersBefore + 1);

    const pastedLayer = after.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();
    expect(pastedLayer!.width).toBe(100);
    expect(pastedLayer!.height).toBe(80);
    expect(after.document.activeLayerId).toBe(pastedLayer!.id);
  });

  test('paste PNG with no document creates "Copied File" document', async ({ page }) => {
    // No document created — still on the new document modal
    await pasteColorPng(page, 200, 150, { r: 0, g: 255, b: 0, a: 255 }, 'Copied File');
    await waitForDocumentReady(page);

    const state = await getEditorState(page);
    expect(state.documentReady).toBe(true);
    expect(state.document.width).toBe(200);
    expect(state.document.height).toBe(150);
    expect(state.document.name).toBe('Copied File');
  });

  test('pasted layer has visible pixel data on GPU', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    // Paste a solid red 200x200 PNG
    await pasteColorPng(page, 200, 200, { r: 255, g: 0, b: 0, a: 255 }, 'Copied File');
    await waitForLayerCount(page, 3);

    // Wait for render
    await page.waitForTimeout(300);

    const result = await readCompositedPixels(page);
    expect(result).not.toBeNull();
    if (!result) return;

    // Check that red pixels are present in the composited output
    let redCount = 0;
    for (let i = 0; i < result.pixels.length; i += 4) {
      const r = result.pixels[i]!;
      const g = result.pixels[i + 1]!;
      const b = result.pixels[i + 2]!;
      if (r > 200 && g < 50 && b < 50) redCount++;
    }
    // Should have a significant number of red pixels on the canvas
    expect(redCount).toBeGreaterThan(100);
  });

  test('paste pushes undo history', async ({ page }) => {
    await createDocument(page, 400, 300);
    const before = await getEditorState(page);

    await pasteColorPng(page, 50, 50, { r: 0, g: 0, b: 255, a: 255 }, 'Copied File');
    await waitForLayerCount(page, before.document.layers.length + 1);

    const after = await getEditorState(page);
    expect(after.undoStackLength).toBeGreaterThan(before.undoStackLength);

    // Undo should remove the pasted layer
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undo: () => void };
      };
      store.getState().undo();
    });

    const undone = await getEditorState(page);
    expect(undone.document.layers).toHaveLength(before.document.layers.length);
  });
});

// ---------------------------------------------------------------------------
// Tests: Drag and drop image file
// ---------------------------------------------------------------------------

test.describe('Drag and drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('drop image onto existing document adds a layer', async ({ page }) => {
    await createDocument(page, 400, 300);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const before = await getEditorState(page);

    await dropImageFile(page, 120, 90, { r: 0, g: 128, b: 255, a: 255 }, 'photo.png');

    await waitForLayerCount(page, before.document.layers.length + 1);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(before.document.layers.length + 1);
    expect(after.document.layers.find((l) => l.name === 'Pasted Layer')).toBeDefined();
  });

  test('drop image with no document opens it as a new document', async ({ page }) => {
    // Stay on the new document modal — don't create a document
    await dropImageFile(page, 300, 200, { r: 255, g: 128, b: 0, a: 255 }, 'sunset.png');

    await waitForDocumentReady(page);

    const state = await getEditorState(page);
    expect(state.documentReady).toBe(true);
    expect(state.document.width).toBe(300);
    expect(state.document.height).toBe(200);
  });

  test('dropped image is visible on canvas', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await dropImageFile(page, 200, 200, { r: 0, g: 255, b: 0, a: 255 }, 'green.png');

    await waitForLayerCount(page, 3);
    await page.waitForTimeout(300);

    const result = await readCompositedPixels(page);
    expect(result).not.toBeNull();
    if (!result) return;

    // Should have green pixels on the canvas
    let greenCount = 0;
    for (let i = 0; i < result.pixels.length; i += 4) {
      const r = result.pixels[i]!;
      const g = result.pixels[i + 1]!;
      const b = result.pixels[i + 2]!;
      if (g > 200 && r < 50 && b < 50) greenCount++;
    }
    expect(greenCount).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Tests: Dimension preservation
// ---------------------------------------------------------------------------

test.describe('Dimension preservation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('pasted image preserves original dimensions', async ({ page }) => {
    await createDocument(page, 800, 600);

    // Paste a small image — layer should match source dimensions, not canvas
    await pasteColorPng(page, 64, 32, { r: 128, g: 128, b: 128, a: 255 }, 'Copied File');
    await waitForLayerCount(page, 4); // bg + layer 1 + group + pasted

    const state = await getEditorState(page);
    const pasted = state.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pasted).toBeDefined();
    expect(pasted!.width).toBe(64);
    expect(pasted!.height).toBe(32);
  });

  test('large pasted image dimensions are preserved', async ({ page }) => {
    await createDocument(page, 200, 200);

    // Paste a larger image — layer size should match the source, not the canvas
    await pasteColorPng(page, 1024, 768, { r: 200, g: 100, b: 50, a: 255 }, 'Copied File');
    await waitForLayerCount(page, 4);

    const state = await getEditorState(page);
    const pasted = state.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pasted).toBeDefined();
    expect(pasted!.width).toBe(1024);
    expect(pasted!.height).toBe(768);
  });
});
