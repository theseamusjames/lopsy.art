import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, waitForStore } from './helpers';

// #979: a plain click with the Gradient tool used to push an empty
// "Linear Gradient" undo step, so ⌘Z visibly did nothing until the stray
// entries were used up.

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

async function clickAt(page: Page, docX: number, docY: number): Promise<void> {
  const p = await docToScreen(page, docX, docY);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function dragGradient(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function compositeSum(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ pixels: number[] } | null>;
    const r = await read();
    if (!r) return -1;
    let sum = 0;
    for (let i = 0; i < r.pixels.length; i += 4) sum += r.pixels[i]! + r.pixels[i + 1]! + r.pixels[i + 2]!;
    return sum;
  });
}

test.describe('Gradient click without drag (#979)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.locator('[data-tool-id="gradient"]').click();
  });

  test('clicks without dragging add no history rows and change no pixels', async ({ page }) => {
    const before = await historyLabels(page);
    const sumBefore = await compositeSum(page);

    await clickAt(page, 100, 100);
    await clickAt(page, 200, 150);
    await clickAt(page, 300, 200);

    expect(await historyLabels(page)).toEqual(before);
    expect(await compositeSum(page)).toBe(sumBefore);
  });

  test('a stray click after a real gradient leaves a single undo step to reverse it', async ({ page }) => {
    const before = await historyLabels(page);
    const sumBefore = await compositeSum(page);

    await dragGradient(page, [20, 150], [380, 150]);
    const sumAfterGradient = await compositeSum(page);
    expect(sumAfterGradient).not.toBe(sumBefore);
    expect(await historyLabels(page)).toEqual([...before, 'Linear Gradient']);

    await clickAt(page, 200, 100);
    await clickAt(page, 50, 250);
    expect(await historyLabels(page)).toEqual([...before, 'Linear Gradient']);
    expect(await compositeSum(page)).toBe(sumAfterGradient);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(await historyLabels(page)).toEqual(before);
    expect(await compositeSum(page)).toBe(sumBefore);
  });
});
