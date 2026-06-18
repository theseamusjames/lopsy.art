/**
 * Regression test for transform stretch clipping.
 *
 * Bug: When a raster layer with content smaller than the doc was selected and
 * stretched via transform handles, the content clipped at the original texture
 * boundary. Dragging the left handle further left than the original content
 * edge produced transparent pixels where red (stretched) content should be.
 *
 * Fix: float_selection now calls expand_layer_to_doc_size synchronously before
 * creating the float, so the float is always doc-sized and can be stretched in
 * any direction without hitting a texture boundary.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, drawRect } from './helpers';

const isMac = process.platform === 'darwin';

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(({ docX, docY }) => {
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
    const screenX = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
    const screenY = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
    return { x: rect.left + screenX, y: rect.top + screenY };
  }, { docX, docY });
}

async function cmdClickThumbnail(page: Page) {
  const thumbnail = page.locator('[class*="thumbnail"]').first();
  await thumbnail.click({ modifiers: [isMac ? 'Meta' : 'Control'] });
  await page.waitForTimeout(300);
}

async function getScaleHandlePos(page: Page, handle: string) {
  return page.evaluate((handleName) => {
    const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: Record<string, unknown> | null };
    };
    const transform = uiStore.getState().transform;
    if (!transform) return null;

    const ob = transform.originalBounds as { x: number; y: number; width: number; height: number };
    const scaleX = transform.scaleX as number;
    const scaleY = transform.scaleY as number;
    const translateX = transform.translateX as number;
    const translateY = transform.translateY as number;
    const rot = transform.rotation as number;
    const skewX = (transform.skewX as number) ?? 0;
    const skewY = (transform.skewY as number) ?? 0;

    const origCx = ob.x + ob.width / 2;
    const origCy = ob.y + ob.height / 2;
    const tanSkewX = Math.tan(skewX);
    const tanSkewY = Math.tan(skewY);

    function transformPt(px: number, py: number) {
      let x = px - origCx;
      let y = py - origCy;
      const sx = x + y * tanSkewX;
      const sy = x * tanSkewY + y;
      x = sx * scaleX;
      y = sy * scaleY;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      return {
        x: x * cos - y * sin + origCx + translateX,
        y: x * sin + y * cos + origCy + translateY,
      };
    }

    const left = ob.x;
    const right = ob.x + ob.width;
    const top = ob.y;
    const bottom = ob.y + ob.height;
    const midX = ob.x + ob.width / 2;
    const midY = ob.y + ob.height / 2;

    const handleMap: Record<string, { x: number; y: number }> = {
      'top-left': transformPt(left, top),
      'top': transformPt(midX, top),
      'top-right': transformPt(right, top),
      'right': transformPt(right, midY),
      'bottom-right': transformPt(right, bottom),
      'bottom': transformPt(midX, bottom),
      'bottom-left': transformPt(left, bottom),
      'left': transformPt(left, midY),
    };

    return handleMap[handleName] ?? null;
  }, handle);
}

async function dragScaleHandle(page: Page, handle: string, toDocX: number, toDocY: number) {
  await page.keyboard.press('v');
  await page.waitForTimeout(50);
  const pos = await getScaleHandlePos(page, handle);
  if (!pos) throw new Error(`No transform state for handle ${handle}`);

  const start = await docToScreen(page, pos.x, pos.y);
  const end = await docToScreen(page, toDocX, toDocY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/**
 * Read layer pixels from GPU and check a single pixel at layer-local coords.
 * Layer-local (0, 0) = engine origin for this layer. After expand_layer_to_doc_size
 * the layer origin is (0, 0), so layer-local coords equal doc coords.
 */
async function readLayerPixelAtLocal(
  page: Page,
  layerId: string,
  localX: number,
  localY: number,
): Promise<{ r: number; g: number; b: number; a: number; texW: number; texH: number }> {
  return page.evaluate(
    async ({ layerId, localX, localY }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(layerId);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0, texW: 0, texH: 0 };
      if (localX < 0 || localX >= result.width || localY < 0 || localY >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0, texW: result.width, texH: result.height };
      }
      const idx = (localY * result.width + localX) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
        texW: result.width,
        texH: result.height,
      };
    },
    { layerId, localX, localY },
  );
}

test.describe('Transform stretch clipping regression', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(200);
  });

  test('stretch left handle beyond original content boundary does not clip', async ({ page }) => {
    // Draw a red rect in the RIGHT portion of the doc.
    // After auto-crop: layer at doc x=350–500, y=150–250 (150x100 texture).
    await drawRect(page, 350, 150, 150, 100, { r: 255, g: 0, b: 0 });

    const { layerId } = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { layerId: store.getState().document.activeLayerId };
    });

    // Cmd+click selects the content and opens transform handles
    await cmdClickThumbnail(page);

    const selActive = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection.active;
    });
    expect(selActive).toBe(true);

    // Drag the LEFT handle from ~x=350 to x=100 — 250px past the original left edge.
    // With the fix: expand_layer_to_doc_size runs synchronously inside float_selection
    // before the float is created, so the full 600x400 texture backs the stretch.
    // Without the fix: the float is created from the 150x100 texture and content
    // clips at x=350 when dragged further left.
    await dragScaleHandle(page, 'left', 100, 200);

    await page.screenshot({ path: 'e2e/screenshots/transform-stretch-left-during.png' });

    // Commit the transform
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    await page.screenshot({ path: 'e2e/screenshots/transform-stretch-left-after.png' });

    // After expand_layer_to_doc_size + float commit, the engine's layer is doc-sized
    // (600x400) with origin (0,0). Layer-local coords = doc coords.
    // The stretched red content should now span from x≈100 to x≈500, y=150–250.

    // Probe at doc (150, 200): well inside the left-stretched region.
    // Old bug: this coordinate was left of the original texture boundary (x=350)
    // and would be transparent. Fixed: red content fills the stretched area.
    const leftProbe = await readLayerPixelAtLocal(page, layerId, 150, 200);
    console.log(`  Texture: ${leftProbe.texW}x${leftProbe.texH}`);
    console.log(`  Left probe (150, 200): R=${leftProbe.r}, A=${leftProbe.a}`);

    // The layer texture should have been expanded to doc size by the fix
    expect(leftProbe.texW).toBeGreaterThanOrEqual(500);

    // The stretched red content must reach x=150 (250px left of original x=350)
    expect(leftProbe.a).toBeGreaterThan(10);
    expect(leftProbe.r).toBeGreaterThan(100);

    // Probe at doc (460, 200): inside the original content region, must also be red
    const centerProbe = await readLayerPixelAtLocal(page, layerId, 460, 200);
    console.log(`  Center probe (460, 200): R=${centerProbe.r}, A=${centerProbe.a}`);
    expect(centerProbe.a).toBeGreaterThan(10);
    expect(centerProbe.r).toBeGreaterThan(100);
  });

  test('stretch right handle beyond original content boundary does not clip', async ({ page }) => {
    // Draw a blue rect in the LEFT portion of the doc.
    // After auto-crop: layer at doc x=50–200, y=150–250 (150x100 texture).
    await drawRect(page, 50, 150, 150, 100, { r: 0, g: 0, b: 255 });

    const { layerId } = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { layerId: store.getState().document.activeLayerId };
    });

    await cmdClickThumbnail(page);

    // Drag the RIGHT handle from ~x=200 to x=500 — 300px past the original right edge
    await dragScaleHandle(page, 'right', 500, 200);

    await page.screenshot({ path: 'e2e/screenshots/transform-stretch-right-during.png' });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    await page.screenshot({ path: 'e2e/screenshots/transform-stretch-right-after.png' });

    // After commit: blue content should span from x≈50 to x≈500.
    // Probe at doc (450, 200): well past original right edge (x=200).
    const rightProbe = await readLayerPixelAtLocal(page, layerId, 450, 200);
    console.log(`  Texture: ${rightProbe.texW}x${rightProbe.texH}`);
    console.log(`  Right probe (450, 200): B=${rightProbe.b}, A=${rightProbe.a}`);

    expect(rightProbe.texW).toBeGreaterThanOrEqual(500);
    expect(rightProbe.a).toBeGreaterThan(10);
    expect(rightProbe.b).toBeGreaterThan(100);

    // Probe at doc (100, 200): inside original content, should still be blue
    const origProbe = await readLayerPixelAtLocal(page, layerId, 100, 200);
    console.log(`  Original region probe (100, 200): B=${origProbe.b}, A=${origProbe.a}`);
    expect(origProbe.a).toBeGreaterThan(10);
    expect(origProbe.b).toBeGreaterThan(100);
  });
});
