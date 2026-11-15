/**
 * #1277 — a Photo Filter node did nothing while a Black & White node was
 * enabled on the same group. The adjustment shader ran Photo Filter before
 * Black & White, which rebuilds RGB from a grey, so the tint was thrown away
 * and the group rendered plain grey whatever the list order.
 *
 * The shader now applies Photo Filter after Black & White (FEATURES.md
 * documents the fixed order), so either list order gives a toned monochrome.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  docToScreen,
  getEditorState,
  addAdjustment,
} from './helpers';

type Rgb = [number, number, number];

const SOURCE: Rgb = [0x30, 0x60, 0xc0];
const PROBE = { x: 200, y: 150 };

async function fillWholeLayer(page: Page, rgb: Rgb): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, 20, 20);
  const end = await docToScreen(page, 380, 280);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await setForegroundColor(page, ...rgb);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function compositeAt(page: Page, x: number, y: number): Promise<Rgb> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
    const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
    const i = ((p.height - 1 - sy) * p.width + sx) * 4;
    return [p.pixels[i] ?? 0, p.pixels[i + 1] ?? 0, p.pixels[i + 2] ?? 0] as Rgb;
  }, { x, y });
}

/** New Group, a layer inside it filled with #3060C0; returns the group id. */
async function setUpBlueGroup(page: Page): Promise<string> {
  await page.locator('[aria-label="New Group"]').click();
  const groupId = (await getEditorState(page)).document.activeLayerId!;
  await page.locator('[aria-label="Add Layer"]').click();
  await fillWholeLayer(page, SOURCE);
  const filled = await compositeAt(page, PROBE.x, PROBE.y);
  for (let i = 0; i < 3; i++) expect(Math.abs(filled[i]! - SOURCE[i]!)).toBeLessThanOrEqual(3);
  return groupId;
}

function expectAmberMonochrome(rgb: Rgb): void {
  const [r, g, b] = rgb;
  // Without the fix this is a neutral grey (r ≈ g ≈ b ≈ 85–91). The amber
  // filter (#ffa000, density 70, Preserve Luminosity) on that grey gives
  // roughly (111, 82, 33): red well above blue, green in between.
  expect(r - b).toBeGreaterThan(40);
  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
  // Still a monochrome of the blue source, not the blue source tinted:
  // Black & White ran, so blue is no longer the dominant channel.
  expect(b).toBeLessThan(SOURCE[2] - 100);
}

test.describe('Photo Filter with Black & White (#1277)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'adjustments drawer needs the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
  });

  test('Photo Filter listed before Black & White tints the monochrome', async ({ page }) => {
    const groupId = await setUpBlueGroup(page);

    await addAdjustment(page, groupId, 'photo-filter', { density: 70 });
    await page.waitForTimeout(300);
    const tintedOnly = await compositeAt(page, PROBE.x, PROBE.y);
    // Amber on blue alone: the olive the issue describes (blue pulled down).
    expect(tintedOnly[2]).toBeLessThan(SOURCE[2] - 40);

    await addAdjustment(page, groupId, 'black-white');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/photo-filter-after-bw-pf-first.png' });

    expectAmberMonochrome(await compositeAt(page, PROBE.x, PROBE.y));
  });

  test('Photo Filter listed after Black & White tints the monochrome', async ({ page }) => {
    const groupId = await setUpBlueGroup(page);

    await addAdjustment(page, groupId, 'black-white');
    await page.waitForTimeout(300);
    const grey = await compositeAt(page, PROBE.x, PROBE.y);
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThanOrEqual(3);

    await addAdjustment(page, groupId, 'photo-filter', { density: 70 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/photo-filter-after-bw-bw-first.png' });

    expectAmberMonochrome(await compositeAt(page, PROBE.x, PROBE.y));
  });
});
