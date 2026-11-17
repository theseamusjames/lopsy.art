/**
 * #1759 — Smudge stamped a normal-speed drag at 25% of Size, so each dab's
 * falloff showed as a band ("ladder") down the trail, while a slow drag
 * collapsed the pitch to the pointer rate and gave a different, shorter
 * smear. Dabs are now a fixed, close distance apart along the drag, so the
 * trail fades smoothly and does not depend on pointer speed.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, getEditorState } from './helpers';

async function dragDoc(page: Page, x: number, y0: number, y1: number, steps: number): Promise<void> {
  const a = await docToScreen(page, x, y0);
  const b = await docToScreen(page, x, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Alpha down column `x`, every 3 px from y = 165 to 255. */
async function trailProfile(page: Page, layerId: string, x: number): Promise<number[]> {
  return page.evaluate(async ({ id, col }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = w.__readLayerPixels as (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, pixels } = await read(id);
    const out: number[] = [];
    for (let y = 165; y <= 255; y += 3) {
      out.push(pixels[((y - layer.y) * width + (col - layer.x)) * 4 + 3] ?? 0);
    }
    return out;
  }, { id: layerId, col: x });
}

test.describe('Smudge spacing (#1759)', () => {
  test('a normal-speed drag smears smoothly and matches a slow drag', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse drags need a desktop pointer');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, true);
    await page.waitForTimeout(200);
    const layerId = (await getEditorState(page)).document.activeLayerId;
    if (!layerId) throw new Error('no active layer');

    await setForegroundColor(page, 0xc4, 0x52, 0x1b);
    await selectTool(page, 'marquee-rect');
    const a = await docToScreen(page, 100, 60);
    const b = await docToScreen(page, 500, 160);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);

    await selectTool(page, 'smudge');
    await setToolOption(page, 'Size', 20);
    await setToolOption(page, 'Strength', 90);

    await dragDoc(page, 180, 150, 300, 10);
    await dragDoc(page, 300, 150, 300, 30);
    await dragDoc(page, 420, 150, 300, 150);

    const fast = await trailProfile(page, layerId, 180);
    const medium = await trailProfile(page, layerId, 300);
    const slow = await trailProfile(page, layerId, 420);
    console.log({ fast, medium, slow });

    // The smear reaches into the transparent area at all.
    expect(fast[0]).toBeGreaterThan(100);
    // No ladder: down the trail the alpha only falls (a few levels of noise
    // allowed), where the banded trail rose again by 10-20 at every dab.
    for (const profile of [fast, medium, slow]) {
      for (let i = 1; i < profile.length; i++) {
        expect(profile[i]!, `rise at sample ${i}: ${profile.join(', ')}`).toBeLessThanOrEqual(profile[i - 1]! + 3);
      }
    }
    // Pointer speed no longer changes the smear.
    for (let i = 0; i < slow.length; i++) {
      expect(Math.abs(fast[i]! - slow[i]!)).toBeLessThanOrEqual(8);
      expect(Math.abs(medium[i]! - slow[i]!)).toBeLessThanOrEqual(8);
    }
  });
});
