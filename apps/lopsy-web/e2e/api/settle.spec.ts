/**
 * What the registry's settle wait (src/commands/settled.ts) covers beyond
 * "everything rendered": a layer switch's deferred crop of the layer it
 * left (src/app/deferred-crop-on-switch.ts) lands before a command resolves.
 */
import { test, expect, run } from './harness';

interface LayerBounds {
  name: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
}

async function layerBounds(page: Parameters<typeof run>[0]): Promise<LayerBounds[]> {
  const info = await run<{ layers: LayerBounds[] }>(page, { op: 'doc.info' });
  return info.layers.map(({ name, x, y, width, height }) => ({ name, x, y, width, height }));
}

test('layer.add resolves after the crop of the layer it left: doc.info reads the same bounds 700 ms apart', async ({ page }) => {
  await run(page, { op: 'doc.new', width: 200, height: 160 });
  await run(page, { op: 'paint.stroke', points: [{ x: 40, y: 40 }, { x: 60, y: 50 }] });
  await run(page, { op: 'layer.add' });
  const first = await layerBounds(page);
  await page.waitForTimeout(700);
  const second = await layerBounds(page);
  expect(second).toEqual(first);
  const layer1 = first.find((layer) => layer.name === 'Layer 1');
  expect(layer1?.width).toBeLessThan(200);
});
