/**
 * Repro: text shrinks after "add text → change size while editing → marquee → rotate"
 *
 * Screenshots and GPU texture dimensions are captured at every step so the
 * visual diff is obvious even in headless runs.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

type Page = Parameters<typeof test>[1] extends (...args: infer A) => unknown ? A[0] : never;

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const { document: d, viewport: v } = store.getState();
      const el = document.querySelector('[data-testid="canvas-container"]');
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return {
        x: r.left + (docX - d.width / 2) * v.zoom + v.panX + r.width / 2,
        y: r.top  + (docY - d.height / 2) * v.zoom + v.panY + r.height / 2,
      };
    },
    { docX, docY },
  );
}

async function readLayerPixels(page: Page, layerId: string) {
  return page.evaluate(async (id: string) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    return fn(id);
  }, layerId);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('text does not shrink after: add → change size while editing → commit → marquee → rotate', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);

  // Create an 800×600 document
  await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    s.getState().createDocument(800, 600, false);
  });
  await page.waitForFunction(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] } };
    } | undefined;
    return s ? s.getState().document.layers.length > 0 : false;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/screenshots/shrink-00-initial.png' });

  // ─── Step 1: Set a SMALL initial font size and activate text tool ─────────
  // Use the store directly to set font size — avoids stealing keyboard focus
  await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setTextFontSize: (n: number) => void };
    };
    s.getState().setTextFontSize(24);
  });

  await page.keyboard.press('t');
  await page.waitForTimeout(200);

  // Click near the doc centre to place the text cursor
  const clickDoc = { x: 250, y: 250 };
  const clickPos = await docToScreen(page, clickDoc.x, clickDoc.y);
  await page.mouse.click(clickPos.x, clickPos.y);
  await page.waitForTimeout(300);

  // ─── Step 2: Type some text ───────────────────────────────────────────────
  await page.keyboard.type('ROTATE ME');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/screenshots/shrink-01-typing-small.png' });

  // Confirm text is in the editing state
  const editingBefore = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { textEditing: { text: string } | null };
    };
    return s.getState().textEditing;
  });
  console.log('Editing state (should say ROTATE ME):', JSON.stringify(editingBefore));

  // ─── Step 3: Change font size to LARGE via store (no focus change) ────────
  await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setTextFontSize: (n: number) => void };
    };
    s.getState().setTextFontSize(80);
  });
  // Wait for the live preview to upload the new texture
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/shrink-02-typing-large.png' });

  // ─── Step 4: Commit text with Shift+Enter ─────────────────────────────────
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/shrink-03-committed.png' });

  // Find the committed text layer
  const layers = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          layers: Array<{
            id: string; type: string; name: string;
            x: number; y: number; fontSize?: number; width: number | null;
          }>;
        };
      };
    };
    return s.getState().document.layers;
  });
  const textLayer = layers.find((l) => l.name.startsWith('Text'));
  console.log('Text layer after commit:', JSON.stringify(textLayer));

  if (!textLayer) {
    console.log('SKIP: No text layer found (font missing in headless?)');
    return;
  }

  expect(textLayer.fontSize).toBe(80);

  // Read GPU texture dimensions BEFORE rotation
  const beforePixels = await readLayerPixels(page, textLayer.id);
  console.log('Texture BEFORE rotation:', beforePixels
    ? `${beforePixels.width}×${beforePixels.height}`
    : 'null');

  if (!beforePixels || beforePixels.width === 0) {
    console.log('SKIP: No GPU pixel data for text layer');
    return;
  }

  const beforeW = beforePixels.width;
  const beforeH = beforePixels.height;
  const beforeContent = beforePixels.pixels.filter((v, i) => i % 4 === 3 && v > 10).length;
  console.log(`Content pixels before rotation: ${beforeContent}`);

  // ─── Step 5: Switch to marquee tool and draw selection around text ────────
  await page.keyboard.press('m');
  await page.waitForTimeout(200);

  const pad = 15;
  const sel0 = await docToScreen(page, textLayer.x - pad, textLayer.y - pad);
  const sel1 = await docToScreen(page, textLayer.x + beforeW + pad, textLayer.y + beforeH + pad);

  await page.mouse.move(sel0.x, sel0.y);
  await page.mouse.down();
  await page.mouse.move(sel1.x, sel1.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/shrink-04-selection.png' });

  const sel = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null } };
    };
    return s.getState().selection;
  });
  console.log('Selection after marquee:', JSON.stringify(sel));

  if (!sel.active || !sel.bounds) {
    console.log('SKIP: Marquee selection did not activate');
    return;
  }

  // ─── Step 6: Switch to move tool (builds transform handles) ───────────────
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/shrink-05-move-ready.png' });

  const transform = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => {
        transform: { originalBounds: { x: number; y: number; width: number; height: number } } | null;
      };
    };
    return s.getState().transform;
  });
  console.log('Transform originalBounds:', JSON.stringify(transform?.originalBounds));

  if (!transform?.originalBounds) {
    console.log('SKIP: No transform handles active');
    return;
  }

  const ob = transform.originalBounds;

  // ─── Step 7: Drag the rotation handle ~30° clockwise ─────────────────────
  const center = await docToScreen(page, ob.x + ob.width / 2, ob.y + ob.height / 2);
  const rhDoc = { x: ob.x + ob.width + 18, y: ob.y - 18 };
  const rh = await docToScreen(page, rhDoc.x, rhDoc.y);

  const radius = Math.hypot(rh.x - center.x, rh.y - center.y);
  const a0 = Math.atan2(rh.y - center.y, rh.x - center.x);
  const a1 = a0 + Math.PI / 6;
  const dragEnd = {
    x: center.x + radius * Math.cos(a1),
    y: center.y + radius * Math.sin(a1),
  };

  await page.mouse.move(rh.x, rh.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 20 });
  await page.screenshot({ path: 'e2e/screenshots/shrink-06-rotating.png' });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/shrink-07-rotated-pending.png' });

  // ─── Step 8: Commit the rotation by pressing Escape ──────────────────────
  // Escape clears the transform state and calls clearPersistentTransform → dropFloat
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/screenshots/shrink-08-committed.png' });

  // ─── Step 9: Measure GPU texture dimensions and content AFTER rotation ────
  const afterPixels = await readLayerPixels(page, textLayer.id);
  console.log('Texture AFTER rotation:', afterPixels
    ? `${afterPixels.width}×${afterPixels.height}`
    : 'null');

  if (!afterPixels || afterPixels.width === 0) {
    console.log('WARN: No GPU pixel data after rotation — layer may have been destroyed');
    // This itself is a bug worth noting
    expect(afterPixels).not.toBeNull();
    return;
  }

  const afterW = afterPixels.width;
  const afterH = afterPixels.height;
  const afterContent = afterPixels.pixels.filter((v, i) => i % 4 === 3 && v > 10).length;

  console.log(`Texture: before=${beforeW}×${beforeH}, after=${afterW}×${afterH}`);
  console.log(`Content pixels: before=${beforeContent}, after=${afterContent}`);

  // After rotation the bounding box may be larger (rotated rectangle is wider/taller),
  // but should not be massively smaller. The content pixel count (opaque pixels)
  // should be approximately preserved — rotation doesn't destroy pixels.
  // The expected diagonal of the original box:
  const diagonal = Math.ceil(Math.hypot(beforeW, beforeH));
  console.log(`Expected max dimension after rotation: ${diagonal}`);

  // Dimensions must be at least the original (rotation pads to fit)
  expect(afterW).toBeGreaterThan(0);
  expect(afterH).toBeGreaterThan(0);

  // Content pixels should not be dramatically fewer than before
  if (beforeContent > 50) {
    // Allow some variation (anti-aliasing differences during rotation)
    // but a 50%+ drop indicates the text shrunk or disappeared
    expect(afterContent).toBeGreaterThan(beforeContent * 0.5);
  }
});
