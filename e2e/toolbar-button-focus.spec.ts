import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, drawRect, docToScreen } from './helpers';

// #817 — a clicked options-bar button kept keyboard focus, so the next
// Enter or Space re-activated it: Move → Flip Horizontal, then Enter,
// flipped the content straight back.
//
// The block is red with a blue stripe on its left edge. After the first
// flip the selection hugs the block, so a second flip mirrors it in
// place — only the stripe moving from one side to the other shows it.

type Channel = 'red' | 'blue';

/** Horizontal extent of the red or blue pixels in document coordinates. */
async function colorDocX(page: Page, channel: Channel): Promise<{ minX: number; maxX: number }> {
  const screen = await page.evaluate(async (ch) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readCompositedPixels as () => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await read();
    const canvas = document.querySelector('[data-testid="canvas-container"] canvas')!;
    const rect = canvas.getBoundingClientRect();
    let minX = r.width;
    let maxX = -1;
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const i = (y * r.width + x) * 4;
        const red = r.pixels[i] ?? 0;
        const green = r.pixels[i + 1] ?? 0;
        const blue = r.pixels[i + 2] ?? 0;
        const isHit = ch === 'red'
          ? red > 150 && green < 60 && blue < 60
          : blue > 150 && red < 60 && green < 60;
        if (!isHit) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    const scale = rect.width / r.width;
    return { minX: rect.left + minX * scale, maxX: rect.left + (maxX + 1) * scale };
  }, channel);
  const origin = await docToScreen(page, 0, 0);
  const unit = (await docToScreen(page, 100, 0)).x - origin.x;
  return {
    minX: Math.round(((screen.minX - origin.x) / unit) * 100),
    maxX: Math.round(((screen.maxX - origin.x) / unit) * 100),
  };
}

async function marquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Red block (50,50)-(120,110), blue stripe on its left 20px. */
async function setUpFlip(page: Page): Promise<void> {
  await drawRect(page, 50, 50, 70, 60, { r: 220, g: 0, b: 0 });
  await drawRect(page, 50, 50, 20, 60, { r: 0, g: 0, b: 220 });
  await marquee(page, 40, 40, 260, 120);
  await selectTool(page, 'move');
  await page.waitForTimeout(150);

  const red = await colorDocX(page, 'red');
  const blue = await colorDocX(page, 'blue');
  expect(red.minX).toBeGreaterThanOrEqual(68);
  expect(red.maxX).toBeLessThanOrEqual(122);
  expect(blue.minX).toBeGreaterThanOrEqual(48);
  expect(blue.maxX).toBeLessThanOrEqual(72);
}

/** Mirrored inside the 40..260 selection: block ≈180..250, stripe on the right. */
async function expectFlipped(page: Page): Promise<void> {
  const red = await colorDocX(page, 'red');
  const blue = await colorDocX(page, 'blue');
  expect(red.minX).toBeGreaterThanOrEqual(176);
  expect(red.maxX).toBeLessThanOrEqual(234);
  expect(blue.minX).toBeGreaterThanOrEqual(226);
  expect(blue.maxX).toBeLessThanOrEqual(254);
}

test.describe('Options-bar buttons do not keep mouse focus (#817)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'options bar transform controls live in a sidebar');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
  });

  test('Enter and Space after Flip Horizontal do not flip back', async ({ page }) => {
    await setUpFlip(page);

    await page.locator('button[aria-label="Flip Horizontal"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'e2e/screenshots/toolbar-focus-817-flipped.png' });
    await expectFlipped(page);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'e2e/screenshots/toolbar-focus-817-after-enter.png' });
    await expectFlipped(page);

    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await expectFlipped(page);

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
    expect(focused).not.toBe('Flip Horizontal');
  });

  test('a keyboard-focused toolbar button still activates with Enter', async ({ page }) => {
    await setUpFlip(page);

    await page.locator('button[aria-label="Flip Horizontal"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await expectFlipped(page);
  });
});
