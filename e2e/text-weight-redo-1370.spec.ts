import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, setToolOption, undo, redo } from './helpers';
import { clickAtDoc } from './text-edit-helpers';
import { serveFontsOffline } from './font-fixtures';

/**
 * #1370: redo of a committed text layer's Font weight change left the old
 * weight's glyphs in the layer texture. The re-render wrote the texture
 * without marking the layer dirty, so the snapshot undo took of the live
 * state reused the pre-change handle whenever the layer's x/y didn't move,
 * and redo restored the old glyphs. Strikethrough never moves the texture's
 * top-left, so it hits that case on every font; the weight test covers the
 * reported control.
 */

interface TextTexture {
  fontWeight: number;
  x: number;
  y: number;
  opaque: number;
}

async function readTextTexture(page: Page): Promise<TextTexture> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; type: string; x: number; y: number; fontWeight?: number }> };
      };
    };
    const read = w.__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const layer = store.getState().document.layers.find((l) => l.type === 'text');
    if (!layer) return { fontWeight: 0, x: 0, y: 0, opaque: 0 };
    const px = await read(layer.id);
    let opaque = 0;
    for (let i = 3; i < px.pixels.length; i += 4) {
      if (px.pixels[i]! > 128) opaque++;
    }
    return { fontWeight: layer.fontWeight ?? 0, x: layer.x, y: layer.y, opaque };
  });
}

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.waitForFunction(
    (f) => {
      const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
      return fn ? fn(f) : false;
    },
    family,
    { timeout: 20000 },
  );
  await page.waitForTimeout(500);
}

async function selectWeight(page: Page, weight: string): Promise<void> {
  await page.getByLabel('Font weight').selectOption(weight);
  await page.waitForTimeout(400);
}

async function commitUnderlinedBoldHello(page: Page): Promise<void> {
  await serveFontsOffline(page);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 400, false);
  await page.waitForTimeout(300);
  await page.keyboard.press('t');
  await setToolOption(page, 'Size', 120);
  await selectFont(page, 'Montserrat');
  await selectWeight(page, '700');
  await page.getByLabel('Toggle underline').click();

  await clickAtDoc(page, 40, 80);
  await page.keyboard.type('HELLO');
  await page.waitForTimeout(150);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(400);
}

test('redo of a committed text layer\'s Strikethrough toggle re-renders the glyphs (#1370)', async ({ page }) => {
  await commitUnderlinedBoldHello(page);
  const plain = await readTextTexture(page);

  await page.getByLabel('Toggle strikethrough').click();
  await page.waitForTimeout(400);
  const struck = await readTextTexture(page);
  expect({ x: struck.x, y: struck.y }).toEqual({ x: plain.x, y: plain.y });
  expect(struck.opaque).toBeGreaterThan(plain.opaque);

  await undo(page);
  await page.waitForTimeout(400);
  expect((await readTextTexture(page)).opaque).toBe(plain.opaque);

  await redo(page);
  await page.waitForTimeout(400);
  expect((await readTextTexture(page)).opaque).toBe(struck.opaque);
});

test('redo of a committed text layer\'s Font weight change re-renders the glyphs (#1370)', async ({ page }) => {
  await commitUnderlinedBoldHello(page);

  const bold = await readTextTexture(page);
  expect(bold.fontWeight).toBe(700);
  expect(bold.opaque).toBeGreaterThan(500);

  await selectWeight(page, '400');
  const regular = await readTextTexture(page);
  expect(regular.fontWeight).toBe(400);
  // Regular strokes are thinner, so fewer opaque pixels than Bold.
  expect(regular.opaque).toBeLessThan(bold.opaque * 0.95);

  await undo(page);
  await page.waitForTimeout(400);
  const undone = await readTextTexture(page);
  expect(undone.fontWeight).toBe(700);
  expect(undone.opaque).toBe(bold.opaque);

  await redo(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/text-weight-redo-1370.png' });
  const redone = await readTextTexture(page);
  expect(redone.fontWeight).toBe(400);
  expect(redone.opaque).toBe(regular.opaque);
});
