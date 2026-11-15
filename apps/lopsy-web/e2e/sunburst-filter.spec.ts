import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, getPixelAt } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

// A 400x300 document puts the burst origin at (200, 150) and the farthest
// corner 250px away, so Length 100% = 250px.
const CX = 200;
const CY = 150;

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.round(CX + Math.cos(rad) * radius), y: Math.round(CY + Math.sin(rad) * radius) };
}

async function runSunburst(
  page: Page,
  sliders: Record<string, number>,
  gaps?: 'Keep Layer' | 'Background Color',
): Promise<void> {
  await page.click('text=Filter');
  await page.click('text=Sunburst...');
  const modal = page.locator('h2:has-text("Sunburst")')
    .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
  await expect(modal).toBeVisible();
  for (const [label, value] of Object.entries(sliders)) {
    const slider = modal.locator(`text="${label}"`).locator('..').locator('input[type="range"]');
    await slider.fill(String(value));
  }
  if (gaps) {
    await modal.locator(`button:has-text("${gaps}")`).click();
  }
  await modal.locator('button:has-text("Apply")').click();
  await page.waitForTimeout(300);
}

function isDark(px: { r: number; g: number; b: number }): boolean {
  return px.r < 40 && px.g < 40 && px.b < 40;
}

test.describe('Sunburst Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    // Default colors: black foreground rays over a white canvas.
    await drawRect(page, 0, 0, 400, 300, { r: 255, g: 255, b: 255 });
    await page.keyboard.press('d');
  });

  test('paints rays along their axes and leaves the gaps alone', async ({ page }) => {
    // 4 rays at 0/90/180/270 degrees, each covering half its 90 degree slot.
    await runSunburst(page, { Rays: 4, Width: 50 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'sunburst-basic.png') });

    for (const angle of [0, 90, 180, 270]) {
      const p = polar(angle, 100);
      expect(isDark(await getPixelAt(page, p.x, p.y))).toBe(true);
    }
    // Diagonals sit in the middle of each gap.
    for (const angle of [45, 135, 225, 315]) {
      const p = polar(angle, 100);
      const px = await getPixelAt(page, p.x, p.y);
      expect(px.r).toBeGreaterThan(230);
    }
  });

  test('Length stops the rays short of the canvas edge', async ({ page }) => {
    // 30% of 250px = 75px rays.
    await runSunburst(page, { Rays: 4, Width: 50, Length: 30 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'sunburst-length.png') });

    const inside = polar(0, 50);
    const outside = polar(0, 150);
    expect(isDark(await getPixelAt(page, inside.x, inside.y))).toBe(true);
    expect((await getPixelAt(page, outside.x, outside.y)).r).toBeGreaterThan(230);
  });

  test('Taper turns wedges into spikes that narrow toward the tip', async ({ page }) => {
    // Full taper flips each ray's width profile: instead of a 22.5 degree
    // half-angle wedge (half-width tan(22.5) = 0.41 x distance along the
    // axis) it is widest at the origin (0.41 * 250 = 104px) and shrinks
    // linearly to a point at 250px.
    await runSunburst(page, { Rays: 4, Width: 50, Taper: 100 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'sunburst-taper.png') });

    // 40 degrees off-axis at r=30 is 19px from the axis, 23px along it:
    // outside an untapered wedge (9px) but inside the spike's wide base
    // (94px), so the rays merge into a solid core.
    const core = polar(40, 30);
    expect(isDark(await getPixelAt(page, core.x, core.y))).toBe(true);
    // 20 degrees off-axis at r=200 is 68px from the axis, 188px along it:
    // inside a wedge (78px) but outside the spike (26px).
    const flank = polar(20, 200);
    expect((await getPixelAt(page, flank.x, flank.y)).r).toBeGreaterThan(230);
    const axis = polar(0, 150);
    expect(isDark(await getPixelAt(page, axis.x, axis.y))).toBe(true);
  });

  test('without taper the rays are wedges that widen outward', async ({ page }) => {
    await runSunburst(page, { Rays: 4, Width: 50 });

    // Mirrors of the taper probes: the flank is lit and the core is not.
    const core = polar(40, 30);
    expect((await getPixelAt(page, core.x, core.y)).r).toBeGreaterThan(230);
    const flank = polar(20, 200);
    expect(isDark(await getPixelAt(page, flank.x, flank.y))).toBe(true);
  });

  test('Fade lightens rays toward their tips', async ({ page }) => {
    await runSunburst(page, { Rays: 4, Width: 50, Fade: 100 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'sunburst-fade.png') });

    const near = await getPixelAt(page, polar(0, 20).x, polar(0, 20).y);
    const mid = await getPixelAt(page, polar(0, 120).x, polar(0, 120).y);
    const far = await getPixelAt(page, polar(0, 190).x, polar(0, 190).y);
    expect(near.r).toBeLessThan(mid.r);
    expect(mid.r).toBeLessThan(far.r);
    expect(near.r).toBeLessThan(40);
  });

  test('Rotation turns the burst', async ({ page }) => {
    await runSunburst(page, { Rays: 4, Width: 50, Rotation: 45 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'sunburst-rotation.png') });

    const onDiagonal = polar(45, 100);
    const onAxis = polar(0, 100);
    expect(isDark(await getPixelAt(page, onDiagonal.x, onDiagonal.y))).toBe(true);
    expect((await getPixelAt(page, onAxis.x, onAxis.y)).r).toBeGreaterThan(230);
  });

  test('Background Color gaps replace the layer between rays', async ({ page }) => {
    await drawRect(page, 0, 0, 400, 300, { r: 220, g: 30, b: 30 });
    await page.keyboard.press('d');

    await runSunburst(page, { Rays: 4, Width: 50 }, 'Background Color');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'sunburst-gaps.png') });

    const gap = await getPixelAt(page, polar(45, 100).x, polar(45, 100).y);
    expect(gap.r).toBeGreaterThan(230);
    expect(gap.g).toBeGreaterThan(230);
    expect(gap.b).toBeGreaterThan(230);
    const ray = await getPixelAt(page, polar(0, 100).x, polar(0, 100).y);
    expect(isDark(ray)).toBe(true);
  });

  test('can be undone', async ({ page }) => {
    const p = polar(0, 100);
    const before = await getPixelAt(page, p.x, p.y);
    await runSunburst(page, { Rays: 4, Width: 50 });
    expect(isDark(await getPixelAt(page, p.x, p.y))).toBe(true);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const after = await getPixelAt(page, p.x, p.y);
    expect(after.r).toBe(before.r);
    expect(after.g).toBe(before.g);
    expect(after.b).toBe(before.b);
  });
});
