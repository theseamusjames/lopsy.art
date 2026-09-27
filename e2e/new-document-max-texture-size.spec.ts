import { test, expect, type Page } from './fixtures';
import { waitForStore, getEditorState, getPixelAt } from './helpers';

// #934 — the New Document dialog accepted sides up to 16384 px regardless of
// the GPU's MAX_TEXTURE_SIZE. Every layer is one texture, so a 16384-wide
// document on an 8192-limit GPU (SwiftShader, many integrated GPUs) failed to
// allocate its textures and left the WASM engine poisoned ("recursive use of
// an object detected which would lead to unsafe aliasing in rust" /
// "unreachable"). The dialog now warns and clamps each side to
// min(16384, MAX_TEXTURE_SIZE).

async function gpuMaxTextureSize(page: Page): Promise<number> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 0;
    const value = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return value;
  });
}

async function openNewDocumentDialog(page: Page) {
  await page.goto('/');
  await waitForStore(page);
  const dialog = page.getByRole('dialog', { name: 'New Document' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function fillSize(page: Page, width: number, height: number): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'New Document' });
  await dialog.locator('select').filter({ hasText: 'Pixels' }).selectOption('px');
  const inputs = dialog.locator('input[type="number"]');
  await inputs.nth(0).fill(String(width));
  await inputs.nth(1).fill(String(height));
}

test.describe('#934 — New Document clamps sides to the GPU texture limit', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'relies on SwiftShader WebGL2 limits');
  });

  test('16384 px wide is clamped to MAX_TEXTURE_SIZE with a warning, and the engine stays healthy', async ({ page }) => {
    const engineErrors: string[] = [];
    page.on('pageerror', (err) => engineErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') engineErrors.push(msg.text());
    });

    await openNewDocumentDialog(page);
    const maxTex = await gpuMaxTextureSize(page);
    test.skip(maxTex === 0 || maxTex >= 16384, `GPU MAX_TEXTURE_SIZE is ${maxTex}; nothing to clamp`);

    await fillSize(page, 16384, 400);

    const warning = page.getByTestId('new-doc-size-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(maxTex.toLocaleString('en-US'));
    await page.screenshot({ path: 'e2e/screenshots/new-document-max-texture-size-warning.png' });

    await page.getByRole('dialog', { name: 'New Document' }).getByRole('button', { name: 'Create' }).click();
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/new-document-max-texture-size-created.png' });

    const { document: doc } = await getEditorState(page);
    expect(doc.width).toBe(maxTex);
    expect(doc.height).toBe(400);

    // The engine allocated the Background texture at full size and can read
    // it back: white at the left edge, the middle and the far right edge.
    const bg = doc.layers.find((l) => l.name === 'Background');
    expect(bg).toBeTruthy();
    for (const x of [5, Math.floor(maxTex / 2), maxTex - 5]) {
      const px = await getPixelAt(page, x, 200, bg!.id);
      expect(px, `background pixel at x=${x}`).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    }

    const poisoned = engineErrors.filter((e) => /unsafe aliasing|unreachable/i.test(e));
    expect(poisoned).toEqual([]);
  });

  test('a normal size shows no warning and is created as typed', async ({ page }) => {
    await openNewDocumentDialog(page);
    await fillSize(page, 1200, 800);

    await expect(page.getByTestId('new-doc-size-warning')).toHaveCount(0);

    await page.getByRole('dialog', { name: 'New Document' }).getByRole('button', { name: 'Create' }).click();
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 15_000 });

    const { document: doc } = await getEditorState(page);
    expect(doc.width).toBe(1200);
    expect(doc.height).toBe(800);
  });
});
