/**
 * Clicking (not dragging) with a marquee tool while nothing is selected opens
 * a modal for typing exact From/To corners. Clicking with a selection active
 * still just deselects.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, selectTool, docToScreen } from './helpers';

interface SelectionSnapshot {
  active: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  maskWidth: number;
  samples: Record<string, number>;
}

async function getSelection(page: Page, points: Array<[number, number]> = []): Promise<SelectionSnapshot> {
  return page.evaluate((pts) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          bounds: { x: number; y: number; width: number; height: number } | null;
          mask: Uint8ClampedArray | null;
          maskWidth: number;
        };
      };
    };
    const sel = store.getState().selection;
    const samples: Record<string, number> = {};
    for (const [x, y] of pts) {
      samples[`${x},${y}`] = sel.mask ? (sel.mask[y * sel.maskWidth + x] ?? -1) : -1;
    }
    return { active: sel.active, bounds: sel.bounds, maskWidth: sel.maskWidth, samples };
  }, points);
}

async function clickCanvas(page: Page, docX: number, docY: number): Promise<void> {
  const pt = await docToScreen(page, docX, docY);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function dragCanvas(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

test.describe('Marquee click-to-enter-region modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('rect marquee click opens the modal pre-filled at the click point', async ({ page }) => {
    await selectTool(page, 'marquee-rect');
    await clickCanvas(page, 150, 120);

    const dialog = page.getByRole('dialog', { name: 'Rectangular Selection' });
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const fromX = Number(await dialog.getByLabel('From X').inputValue());
    const fromY = Number(await dialog.getByLabel('From Y').inputValue());
    expect(Math.abs(fromX - 150)).toBeLessThanOrEqual(1);
    expect(Math.abs(fromY - 120)).toBeLessThanOrEqual(1);
    expect(Number(await dialog.getByLabel('To X').inputValue())).toBe(fromX + 100);
    expect(Number(await dialog.getByLabel('To Y').inputValue())).toBe(fromY + 100);

    // The click alone must not have created a selection.
    expect((await getSelection(page)).active).toBe(false);
  });

  test('typed corners commit an exact rectangular selection', async ({ page }) => {
    await selectTool(page, 'marquee-rect');
    await clickCanvas(page, 200, 150);

    const dialog = page.getByRole('dialog', { name: 'Rectangular Selection' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.getByLabel('From X').fill('20');
    await dialog.getByLabel('From Y').fill('30');
    await dialog.getByLabel('To X').fill('120');
    await dialog.getByLabel('To Y').fill('80');
    await expect(dialog).toContainText('100 × 50 px');
    await dialog.getByRole('button', { name: 'Select' }).click();
    await expect(dialog).toHaveCount(0);

    const sel = await getSelection(page, [[20, 30], [119, 79], [19, 30], [120, 79], [119, 80]]);
    expect(sel.active).toBe(true);
    expect(sel.bounds).toEqual({ x: 20, y: 30, width: 100, height: 50 });
    expect(sel.samples['20,30']).toBe(255);
    expect(sel.samples['119,79']).toBe(255);
    expect(sel.samples['19,30']).toBe(0);
    expect(sel.samples['120,79']).toBe(0);
    expect(sel.samples['119,80']).toBe(0);
  });

  test('elliptical marquee commits an ellipse from typed corners via Enter', async ({ page }) => {
    await selectTool(page, 'marquee-ellipse');
    await clickCanvas(page, 200, 150);

    const dialog = page.getByRole('dialog', { name: 'Elliptical Selection' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
    // Corners in reverse order are normalized.
    await dialog.getByLabel('From X').fill('300');
    await dialog.getByLabel('From Y').fill('250');
    await dialog.getByLabel('To X').fill('100');
    await dialog.getByLabel('To Y').fill('50');
    await dialog.getByLabel('To Y').press('Enter');
    await expect(dialog).toHaveCount(0);

    const sel = await getSelection(page, [[200, 150], [102, 52], [298, 248], [101, 150]]);
    expect(sel.active).toBe(true);
    expect(sel.bounds).toEqual({ x: 100, y: 50, width: 200, height: 200 });
    expect(sel.samples['200,150']).toBe(255);
    expect(sel.samples['101,150']).toBeGreaterThan(0);
    // Bounding-box corners fall outside the ellipse.
    expect(sel.samples['102,52']).toBe(0);
    expect(sel.samples['298,248']).toBe(0);
  });

  test('zero-area region disables Select', async ({ page }) => {
    await selectTool(page, 'marquee-rect');
    await clickCanvas(page, 200, 150);

    const dialog = page.getByRole('dialog', { name: 'Rectangular Selection' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await dialog.getByLabel('To X').fill(await dialog.getByLabel('From X').inputValue());
    await expect(dialog.getByRole('button', { name: 'Select' })).toBeDisabled();
  });

  test('Escape closes the modal without selecting', async ({ page }) => {
    await selectTool(page, 'marquee-rect');
    await clickCanvas(page, 200, 150);

    const dialog = page.getByRole('dialog', { name: 'Rectangular Selection' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect((await getSelection(page)).active).toBe(false);
  });

  test('clicking with a selection active deselects instead of opening the modal', async ({ page }) => {
    await selectTool(page, 'marquee-rect');
    await dragCanvas(page, [20, 20], [120, 120]);
    await expect.poll(async () => (await getSelection(page)).active).toBe(true);

    await clickCanvas(page, 300, 250);
    await expect.poll(async () => (await getSelection(page)).active).toBe(false);
    await expect(page.getByRole('dialog', { name: 'Rectangular Selection' })).toHaveCount(0);
  });
});
