import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  getEditorState,
  docToScreen,
  selectTool,
  setToolOption,
} from './helpers';

interface SymmetryState {
  center: { x: number; y: number } | null;
  radial: number;
}

async function readSymmetry(page: Page): Promise<SymmetryState> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { symmetryCenter: { x: number; y: number } | null; symmetryRadialSegments: number };
    };
    const s = store.getState();
    return { center: s.symmetryCenter, radial: s.symmetryRadialSegments };
  });
}

async function countDarkComposited(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    const { pixels } = await read();
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! > 200 && pixels[i]! < 128 && pixels[i + 1]! < 128 && pixels[i + 2]! < 128) dark++;
    }
    return dark;
  });
}

test.describe('Ctrl+click moves the symmetry centre (#1623)', () => {
  test('Ctrl+click with Radial Symmetry repositions the centre without painting', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Ctrl+click is a desktop gesture');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);

    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 30);
    await page.locator('[aria-label="Radial Symmetry"]').click();
    expect((await readSymmetry(page)).radial).toBe(8);

    const darkBefore = await countDarkComposited(page);
    const undoBefore = (await getEditorState(page)).undoStackLength;

    const target = await docToScreen(page, 120, 90);
    await page.mouse.move(target.x, target.y);
    await page.keyboard.down('Control');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/symmetry-ctrl-click-center.png' });

    const sym = await readSymmetry(page);
    expect(sym.center).not.toBeNull();
    expect(sym.center!.x).toBeCloseTo(120, 0);
    expect(sym.center!.y).toBeCloseTo(90, 0);

    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore);
    // Default foreground is black on a white document: a dab (or any of
    // its eight radial copies) would turn pixels dark.
    expect(await countDarkComposited(page)).toBe(darkBefore);
  });
});
