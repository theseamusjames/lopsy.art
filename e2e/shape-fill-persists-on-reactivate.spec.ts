/**
 * Regression test for #424:
 *
 * The Shape tool's `onActivate` callback used to unconditionally set
 * `shapeFillColor = foregroundColor` on every `setActiveTool('shape')` call.
 * Pressing `U` while the Shape tool was already active, or switching to
 * another tool and back, would silently overwrite the user's chosen fill
 * with the current foreground color.
 *
 * The fix has two parts (both required to cover both repros in the issue):
 *   1. `setActiveTool` no longer fires `onActivate` when the requested tool
 *      is already the active tool — re-pressing `U` is a no-op.
 *   2. The shape tool's foreground → fill seed is a one-shot per session —
 *      after the very first activation, switching to another tool and back
 *      does not clobber the user's chosen fill.
 *
 * Both repros from the issue are covered below: pressing `U` twice, and
 * switching away and back. We verify behavior at three levels:
 *   - the tool-settings store still reports the user-chosen fill,
 *   - a fresh shape drag actually paints with the user-chosen fill,
 *   - the options-bar Fill swatch UI still reflects the user-chosen fill.
 */
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  getPixelAt,
  selectTool,
  setForegroundColor,
} from './helpers';

const GOLD = { r: 0xbc, g: 0x90, b: 0x4c };
const CRIMSON = { r: 0x91, g: 0x26, b: 0x20 };

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        cx;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function dragShape(
  page: Page,
  fromDoc: { x: number; y: number },
  toDoc: { x: number; y: number },
) {
  const start = await docToScreen(page, fromDoc.x, fromDoc.y);
  const end = await docToScreen(page, toDoc.x, toDoc.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/**
 * Set the shape fill color via the store. The popover UI driving this is
 * an HSV picker with no hex input — there is no UI path to set a specific
 * RGB value, so this matches the existing pattern in shape-tool.spec.ts.
 */
async function setShapeFillColor(page: Page, color: { r: number; g: number; b: number; a?: number }) {
  await page.evaluate((c) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setShapeFillColor: (c: unknown) => void };
    };
    store.getState().setShapeFillColor({ r: c.r, g: c.g, b: c.b, a: c.a ?? 1 });
  }, color);
}

async function getShapeFillColor(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { shapeFillColor: { r: number; g: number; b: number; a: number } | null };
    };
    return store.getState().shapeFillColor;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

test.describe('Shape tool fill color persists on re-activation (#424)', () => {
  test('pressing U twice does not reset fill to foreground', async ({ page }) => {
    // 1. Foreground = gold, then activate Shape — fill seeds from foreground.
    await setForegroundColor(page, GOLD.r, GOLD.g, GOLD.b);
    await selectTool(page, 'shape');

    // 2. User picks a distinctive fill in the options-bar popover (crimson).
    await setShapeFillColor(page, CRIMSON);
    expect(await getShapeFillColor(page)).toEqual({ ...CRIMSON, a: 1 });

    // 3. Change the foreground to gold again (it already is, but in the
    //    real workflow the user might be cycling colors). The key step is:
    // 4. Re-press U with the Shape tool already active.
    await page.keyboard.press('u');

    // The fill swatch must NOT have been silently reset to foreground.
    const fillAfter = await getShapeFillColor(page);
    expect(fillAfter).toEqual({ ...CRIMSON, a: 1 });

    // Verify the rendered output matches: a fresh shape drag draws crimson,
    // not gold. Disable stroke so only fill matters.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setShapeStrokeColor: (c: unknown) => void };
      };
      store.getState().setShapeStrokeColor(null);
    });
    await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
    await dragShape(page, { x: 200, y: 150 }, { x: 280, y: 220 });
    await page.screenshot({ path: 'e2e/screenshots/shape-fill-after-rereactivate.png' });

    const center = await getPixelAt(page, 200, 150);
    // Reads must match crimson, not gold. Loose tolerance for AA blending.
    expect(Math.abs(center.r - CRIMSON.r)).toBeLessThan(8);
    expect(Math.abs(center.g - CRIMSON.g)).toBeLessThan(8);
    expect(Math.abs(center.b - CRIMSON.b)).toBeLessThan(8);
    expect(center.a).toBeGreaterThan(200);
  });

  test('switching to another tool and back does not reset fill to foreground', async ({ page }) => {
    // 1. Foreground = gold, then activate Shape — fill seeds from foreground.
    await setForegroundColor(page, GOLD.r, GOLD.g, GOLD.b);
    await selectTool(page, 'shape');

    // 2. User picks a distinctive fill (crimson).
    await setShapeFillColor(page, CRIMSON);
    expect(await getShapeFillColor(page)).toEqual({ ...CRIMSON, a: 1 });

    // 3. User switches to the move tool, then back to shape.
    await selectTool(page, 'move');
    await selectTool(page, 'shape');

    // The fill must still be crimson — this is the second repro from #424.
    const fillAfter = await getShapeFillColor(page);
    expect(fillAfter).toEqual({ ...CRIMSON, a: 1 });

    // The options-bar Fill swatch must visually still show crimson, not
    // gold. The ColorSwatch button has an aria-label like
    // "Color: rgb(r, g, b)" — read that directly.
    const swatchLabel = await page.evaluate(() => {
      const fillLabel = Array.from(document.querySelectorAll('span'))
        .find((el) => el.textContent === 'Fill');
      if (!fillLabel) return null;
      const group = fillLabel.nextElementSibling as HTMLElement | null;
      if (!group) return null;
      const swatch = group.querySelector('button[aria-label^="Color:"]');
      if (!swatch) return null;
      return swatch.getAttribute('aria-label');
    });
    expect(swatchLabel).toBeTruthy();
    const match = (swatchLabel ?? '').match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    expect(match).not.toBeNull();
    const [, r, g, b] = match!;
    expect(Math.abs(Number(r) - CRIMSON.r)).toBeLessThan(8);
    expect(Math.abs(Number(g) - CRIMSON.g)).toBeLessThan(8);
    expect(Math.abs(Number(b) - CRIMSON.b)).toBeLessThan(8);
  });

  test('first activation still seeds fill from foreground', async ({ page }) => {
    // Sanity check: the one-shot logic must not break the "pick a color,
    // then click shape" workflow on the user's first interaction with the
    // shape tool. Foreground = gold, never activated shape before → fill
    // should be gold after the first U press.
    await setForegroundColor(page, GOLD.r, GOLD.g, GOLD.b);
    await selectTool(page, 'shape');

    const fill = await getShapeFillColor(page);
    expect(fill).toEqual({ ...GOLD, a: 1 });
  });

  test('changing foreground after shape activation does not affect fill', async ({ page }) => {
    // Foreground = gold, activate shape → fill = gold.
    await setForegroundColor(page, GOLD.r, GOLD.g, GOLD.b);
    await selectTool(page, 'shape');
    expect(await getShapeFillColor(page)).toEqual({ ...GOLD, a: 1 });

    // Switch away, change foreground to crimson, switch back.
    await selectTool(page, 'move');
    await setForegroundColor(page, CRIMSON.r, CRIMSON.g, CRIMSON.b);
    await selectTool(page, 'shape');

    // Fill must remain gold — once seeded, it stays.
    const fill = await getShapeFillColor(page);
    expect(fill).toEqual({ ...GOLD, a: 1 });
  });
});
