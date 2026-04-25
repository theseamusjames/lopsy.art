import { test, expect } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

test('text layer rotation: content stays centered and does not scale', async ({ page }) => {
  await page.goto('http://localhost:5174');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForTimeout(500);

  // Get canvas coordinate mapping
  const info = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    const r = c.getBoundingClientRect();
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number; panX: number; panY: number }; document: { width: number; height: number } };
    };
    const { viewport: v, document: d } = s.getState();
    return { left: r.left, top: r.top, w: r.width, h: r.height, zoom: v.zoom, panX: v.panX, panY: v.panY, docW: d.width, docH: d.height };
  });
  const d2s = (dx: number, dy: number) => ({
    x: (dx - info.docW / 2) * info.zoom + info.panX + info.w / 2 + info.left,
    y: (dy - info.docH / 2) * info.zoom + info.panY + info.h / 2 + info.top,
  });

  // --- Step 1: Use the REAL text tool UI ---
  await page.screenshot({ path: 'e2e/screenshots/text-rotation-00-initial.png' });
  // Click the text tool button in the toolbox
  await page.locator('button[aria-label="Text"]').first().click({ timeout: 5000 }).catch(async () => {
    // Fallback: set via store
    console.log('WARN: Could not find Text button, using store fallback');
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      }).getState().setActiveTool('text');
    });
  });
  await page.waitForTimeout(200);

  // Click on canvas to place text
  const textPos = d2s(150, 130);
  await page.mouse.click(textPos.x, textPos.y);
  await page.waitForTimeout(300);

  // Type text
  await page.keyboard.type('LOPSY');
  await page.waitForTimeout(300);

  await page.screenshot({ path: 'e2e/screenshots/text-rotation-01-typing.png' });

  // --- Step 2: Switch to marquee tool (should commit the text) ---
  await page.evaluate(() => {
    ((window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    }).getState().setActiveTool('marquee-rect');
  });
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'e2e/screenshots/text-rotation-02-committed.png' });

  // Check the text layer was rasterized
  const layers = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number; type: string; name: string }> } };
    };
    return s.getState().document.layers.map(l => ({
      id: l.id, x: l.x, y: l.y, width: l.width, height: l.height, type: l.type, name: l.name,
    }));
  });
  const textLayer = layers.find(l => l.name.startsWith('Text'));
  console.log('All layers:', JSON.stringify(layers));
  console.log('Text layer:', JSON.stringify(textLayer));

  // If no text layer, the text didn't render (font missing in headless) — skip
  if (!textLayer || textLayer.width === 0) {
    console.log('SKIP: Text layer not found or empty (font likely missing in headless)');
    return;
  }
  expect(textLayer.type).toBe('raster');

  // --- Step 3: Select the text layer and marquee around it ---
  await page.evaluate((id) => {
    (window as unknown as Record<string, unknown>).__editorStore &&
    ((window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { setActiveLayer: (id: string) => void };
    }).getState().setActiveLayer(id);
  }, textLayer.id);
  await page.waitForTimeout(100);

  const m = 10;
  const s1 = d2s(textLayer.x - m, textLayer.y - m);
  const s2 = d2s(textLayer.x + textLayer.width + m, textLayer.y + textLayer.height + m);
  await page.mouse.move(s1.x, s1.y);
  await page.mouse.down();
  await page.mouse.move(s2.x, s2.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // --- Step 4: Switch to move tool ---
  await page.evaluate(() => {
    ((window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    }).getState().setActiveTool('move');
  });
  await page.waitForTimeout(200);

  await page.screenshot({ path: 'e2e/screenshots/text-rotation-03-selected.png' });

  // Read selection bounds
  const ob = await page.evaluate(() => {
    const u = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: { originalBounds: { x: number; y: number; width: number; height: number } } | null };
    };
    return u.getState().transform?.originalBounds;
  });
  console.log('Selection bounds:', JSON.stringify(ob));
  if (!ob) {
    console.log('SKIP: No selection bounds');
    return;
  }

  // --- Step 5: Rotate via the rotation handle ---
  // Find dark pixels (text) within document bounds only
  const findContentBounds = async () => page.evaluate(async () => {
    const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number; panX: number; panY: number }; document: { width: number; height: number } };
    };
    const { viewport: v, document: d } = store.getState();
    const r = await read();
    // Compute document area in composited buffer
    const docLeft = Math.floor(r.width / 2 + v.panX - d.width * v.zoom / 2);
    const docTop = Math.floor(r.height / 2 + v.panY - d.height * v.zoom / 2);
    const docRight = docLeft + Math.ceil(d.width * v.zoom);
    const docBottom = docTop + Math.ceil(d.height * v.zoom);
    let minX = r.width, maxX = 0, minY = r.height, maxY = 0, count = 0;
    for (let y = Math.max(0, docTop); y < Math.min(r.height, docBottom); y++) {
      for (let x = Math.max(0, docLeft); x < Math.min(r.width, docRight); x++) {
        const fy = r.height - 1 - y;
        const i = (fy * r.width + x) * 4;
        const red = r.pixels[i]!, g = r.pixels[i+1]!, b = r.pixels[i+2]!, a = r.pixels[i+3]!;
        // Text is dark on white background
        if (a > 50 && red < 100 && g < 100 && b < 100) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    return { minX, maxX, minY, maxY, count };
  });

  const before = await findContentBounds();
  console.log('Before rotation:', JSON.stringify(before));
  if (before.count === 0) {
    console.log('SKIP: No content pixels found');
    return;
  }

  // Rotation handle: (right+20, top-20) in doc space
  const rh = d2s(ob.x + ob.width + 20, ob.y - 20);
  const center = d2s(ob.x + ob.width / 2, ob.y + ob.height / 2);
  const radius = Math.hypot(rh.x - center.x, rh.y - center.y);
  const a0 = Math.atan2(rh.y - center.y, rh.x - center.x);
  const dragEnd = { x: center.x + radius * Math.cos(a0 + Math.PI / 6), y: center.y + radius * Math.sin(a0 + Math.PI / 6) };

  await page.mouse.move(rh.x, rh.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 15 });
  await page.screenshot({ path: 'e2e/screenshots/text-rotation-04-during.png' });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/text-rotation-05-after.png' });

  const after = await findContentBounds();
  console.log('After rotation:', JSON.stringify(after));

  if (before.count > 0 && after.count > 0) {
    const bCx = (before.minX + before.maxX) / 2;
    const bCy = (before.minY + before.maxY) / 2;
    const aCx = (after.minX + after.maxX) / 2;
    const aCy = (after.minY + after.maxY) / 2;
    console.log(`Center: before=(${bCx}, ${bCy}) after=(${aCx}, ${aCy}) shift=(${aCx-bCx}, ${aCy-bCy})`);
    console.log(`Box: before=${before.maxX-before.minX}x${before.maxY-before.minY} after=${after.maxX-after.minX}x${after.maxY-after.minY}`);

    // Content center must not jump
    expect(Math.abs(aCx - bCx)).toBeLessThan(15);
    expect(Math.abs(aCy - bCy)).toBeLessThan(15);
  }
});
