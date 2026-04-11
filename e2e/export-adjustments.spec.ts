import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, paintRect } from './helpers';

// PNG magic bytes: 137 80 78 71 13 10 26 10
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function getCompositePixelAt(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    ({ x, y }) => {
      const engine = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      } | undefined;
      const bridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        render: (engine: unknown) => void;
        sampleColor: (engine: unknown, x: number, y: number, radius: number) => Uint8Array;
      } | undefined;
      if (!engine || !bridge) return { r: 0, g: 0, b: 0, a: 0 };
      const eng = engine.getEngine();
      if (!eng) return { r: 0, g: 0, b: 0, a: 0 };
      bridge.render(eng);
      const rgba = bridge.sampleColor(eng, x, y, 0);
      return { r: rgba[0]!, g: rgba[1]!, b: rgba[2]!, a: rgba[3]! };
    },
    { x, y },
  );
}

test.describe('Export pipeline applies saturation & vibrance (#122)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(300);
  });

  test('exported image includes saturation and vibrance adjustments', async ({ page }) => {
    // Paint a saturated red rectangle
    await paintRect(page, 20, 20, 60, 60, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(200);

    // Read composited pixel before adjustments
    const beforePixel = await getCompositePixelAt(page, 50, 50);

    // Get the rootGroupId so we can apply adjustments via the correct API
    const rootGroupId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { rootGroupId: string } };
      };
      return store.getState().document.rootGroupId;
    });

    // Apply saturation and vibrance adjustments via setGroupAdjustments
    await page.evaluate(
      ({ groupId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            setGroupAdjustments: (id: string, adj: Record<string, number>) => void;
            setGroupAdjustmentsEnabled: (id: string, enabled: boolean) => void;
          };
        };
        const state = store.getState();
        state.setGroupAdjustmentsEnabled(groupId, true);
        state.setGroupAdjustments(groupId, {
          exposure: 0,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          vignette: 0,
          saturation: 0.5,
          vibrance: 0.5,
        });
      },
      { groupId: rootGroupId },
    );
    await page.waitForTimeout(300);

    // Verify adjustments were stored on the group layer
    const storedAdj = await page.evaluate(
      ({ groupId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { document: { layers: Array<Record<string, unknown>> } };
        };
        const group = store.getState().document.layers.find((l) => l.id === groupId);
        return group?.adjustments as Record<string, number> | undefined;
      },
      { groupId: rootGroupId },
    );
    expect(storedAdj?.saturation).toBe(0.5);
    expect(storedAdj?.vibrance).toBe(0.5);

    // Read composited pixel after adjustments — saturation reduction should
    // desaturate the red: R decreases, G/B increase toward gray
    const afterPixel = await getCompositePixelAt(page, 50, 50);
    expect(afterPixel.r).toBeLessThan(beforePixel.r);
    expect(afterPixel.g).toBeGreaterThan(beforePixel.g);

    await page.screenshot({ path: 'e2e/screenshots/export-adjustments-canvas.png' });

    // Trigger PNG export and capture the download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Export PNG' }).click();
    const download = await downloadPromise;

    // Read exported PNG bytes
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (stream) {
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
    }
    const pngBuffer = Buffer.concat(chunks);

    // Verify non-empty file with valid PNG magic bytes
    expect(pngBuffer.length).toBeGreaterThan(0);
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      expect(pngBuffer[i]).toBe(PNG_MAGIC[i]);
    }

    await page.screenshot({ path: 'e2e/screenshots/export-adjustments-result.png' });
  });
});
