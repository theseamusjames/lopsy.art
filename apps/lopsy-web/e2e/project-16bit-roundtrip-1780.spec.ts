import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, addLayer, docToScreen } from './helpers';

/**
 * #1780 — `.lopsy` files stored every layer at 8 bits a channel, so saving
 * and reopening a document rounded its half-float layers: a smooth gradient
 * came back banded to 256 levels. From format v3 the file keeps each layer
 * at 16 bits a channel. The test compares the engine's own 16-bit read of
 * the layer before saving and after reopening, which must match exactly.
 */

async function layer16(page: Page, layerId: string): Promise<number[]> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as {
      __wasmBridge: { readLayerPixelsLz4U16: (engine: unknown, id: string) => Promise<Uint8Array> };
      __engineState: { getEngine: () => unknown };
    };
    const blob = await w.__wasmBridge.readLayerPixelsLz4U16(w.__engineState.getEngine(), lid);
    return Array.from(blob);
  }, layerId);
}

test.describe('#1780 — .lopsy keeps 16-bit layer pixels', () => {
  test('a gradient saved and reopened is unchanged at 16 bits', async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop File menu');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 80, true);
    await page.waitForTimeout(300);
    const layerId = await addLayer(page);

    // A black-to-white gradient across 600 px: neighbouring pixels differ by
    // less than one 8-bit step, so an 8-bit file cannot hold it.
    await page.locator('[data-tool-id="gradient"]').click();
    const a = await docToScreen(page, 0, 40);
    const b = await docToScreen(page, 599, 40);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const before = await layer16(page, layerId);
    expect(before.length).toBeGreaterThan(32);

    await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'File', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /^Save Project/ }).click();
    const download = await downloadPromise;
    const path = await download.path();

    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open File…' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'gradient.lopsy', mimeType: 'application/octet-stream', buffer: readFileSync(path) });
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 20_000 });
    await expect.poll(async () => (await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string }> } };
      };
      return store.getState().document.layers.some((l) => l.id === lid);
    }, layerId)), { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(500);

    const after = await layer16(page, layerId);
    expect(after.length).toBe(before.length);
    expect(after).toEqual(before);
  });
});

test.describe('#1780 — older .lopsy files still open', () => {
  test('a v2 file with 8-bit layers opens with its pixels', async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop New Document dialog');
    await page.goto('/');
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open File…' }).click();
    const chooser = await chooserPromise;
    // Saved by the v2 writer: a 64×16 document with a black-to-white "Ramp" layer.
    await chooser.setFiles('e2e/fixtures/project-v2-ramp.lopsy');
    await expect(page.getByText('Ramp', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);

    const row = await page.evaluate(async () => {
      const w = window as unknown as Record<string, unknown>;
      const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; name: string }> } } };
      const lid = store.getState().document.layers.find((l) => l.name === 'Ramp')!.id;
      const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; pixels: number[] }>;
      const p = await read(lid);
      return [0, 16, 32, 48, 63].map((x) => p.pixels[(8 * p.width + x) * 4] ?? -1);
    });
    const expected = [2, 67, 131, 197, 254];
    row.forEach((v, i) => expect(Math.abs(v - expected[i]!), `x index ${i}: ${JSON.stringify(row)}`).toBeLessThanOrEqual(1));
  });
});
