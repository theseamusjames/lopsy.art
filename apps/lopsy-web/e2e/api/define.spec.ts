/**
 * `pattern.define`, `brush.define` and `quickmask.set`
 * (src/commands/pattern/pattern.ts, src/commands/brush/brush.ts,
 * src/commands/quick-mask/quick-mask.ts). Patterns and brush presets are not
 * in the snapshot, so each comparison goes on to use what was defined
 * through the same UI on both sides (a Fill with Pattern, a brush stroke)
 * and compares the pixels that leaves.
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { createDocument } from '../helpers';
import { brushStroke, clickMenu, dragMarquee, fillRect, historyLabels, settle, surfaceState, toasts } from '../surface-helpers';
import { maskMode, pressKey } from '../surface-helpers-keys';
import { docPixelHash, openMenuDialog, setFilterValue } from '../surface-helpers-filters';

const RED = { r: 255, g: 0, b: 0 };
const BLACK = { r: 0, g: 0, b: 0 };
const STROKE = [{ x: 30, y: 100 }, { x: 100, y: 110 }, { x: 170, y: 100 }];

interface PatternInfo {
  name: string;
  width: number;
  height: number;
}

async function patterns(page: Page): Promise<PatternInfo[]> {
  return page.evaluate(() => {
    const st = (window as unknown as {
      __patternStore: { getState: () => { patterns: PatternInfo[] } };
    }).__patternStore.getState();
    return st.patterns.map((p) => ({ name: p.name, width: p.width, height: p.height }));
  });
}

async function activePreset(page: Page): Promise<{ id: string | null; name: string | null; size: number | null }> {
  return page.evaluate(() => {
    const st = (window as unknown as {
      __toolSettingsStore: { getState: () => { presets: Array<{ id: string; name: string; size: number }>; activePresetId: string | null } };
    }).__toolSettingsStore.getState();
    const preset = st.presets.find((p) => p.id === st.activePresetId);
    return { id: st.activePresetId, name: preset?.name ?? null, size: preset?.size ?? null };
  });
}

async function freshDocument(page: Page): Promise<void> {
  await createDocument(page, 200, 150, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
}

/** A 20x20 capture whose left half is red and right half clear, selected by a marquee. */
async function halfRedMarquee(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 30, 40, RED);
  await pressKey(page, 'ControlOrMeta+d');
  await dragMarquee(page, 20, 20, 40, 40);
}

/** Drop the marquee, add a layer and fill it with the current pattern at 50%. */
async function fillNewLayerWithPattern(page: Page): Promise<void> {
  await pressKey(page, 'ControlOrMeta+d');
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  const dialog = await openMenuDialog(page, 'Edit', 'Fill with Pattern...', 'Pattern Fill');
  await setFilterValue(dialog, 'Scale', 50);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await settle(page, 300);
}

/** A black block at (20,20)-(60,50), still selected: a brush tip 40x30. */
async function blackBlock(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 60, 50, BLACK);
}

/** Drop the marquee and paint one stroke with the active preset on a new layer. */
async function strokeWithPreset(page: Page): Promise<void> {
  await pressKey(page, 'ControlOrMeta+d');
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  await brushStroke(page, STROKE, RED);
}

test.describe('Edit > Define Pattern and pattern.define', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
  });

  test('pattern.define matches Edit > Define Pattern: the same Fill with Pattern then leaves the same pixels', async ({ page }) => {
    const defined: PatternInfo[][] = [];
    const { api } = await compareUiAndApi(page, {
      setup: halfRedMarquee,
      viaUi: async (p) => {
        await clickMenu(p, 'Edit', 'Define Pattern');
        await expect.poll(async () => (await patterns(p)).length).toBe(1);
        defined.push(await patterns(p));
        await fillNewLayerWithPattern(p);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'pattern.define' })).toMatchObject({ name: 'Pattern 1', width: 20, height: 20 });
        defined.push(await patterns(p));
        await fillNewLayerWithPattern(p);
      },
    });
    expect(defined[1]).toEqual(defined[0]);
    expect(api.history.undo).toEqual(['New Document', 'Fill', 'Add Layer', 'Pattern Fill']);
  });

  test('pattern.define makes filter.pattern-fill usable: define, then fill another layer with it by id', async ({ page }) => {
    await freshDocument(page);
    await halfRedMarquee(page);
    const pattern = await run<{ id: string; name: string; width: number; height: number }>(page, { op: 'pattern.define', name: 'Half' });
    expect(pattern).toMatchObject({ name: 'Half', width: 20, height: 20 });
    expect(await patterns(page)).toEqual([{ name: 'Half', width: 20, height: 20 }]);
    await run(page, { op: 'select.none' });
    const { id: layer } = await run<{ id: string }>(page, { op: 'layer.add' });
    const blank = await docPixelHash(page, layer);
    await run(page, { op: 'filter.pattern-fill', pattern: pattern.id, scale: 50 });
    expect(await docPixelHash(page, layer)).not.toBe(blank);
    expect((await historyLabels(page)).at(-1)).toBe('Pattern Fill');
  });

  test('pattern.define refuses a group with the text Edit > Define Pattern toasts', async ({ page }) => {
    await freshDocument(page);
    await clickMenu(page, 'Layer', 'Group Layers');
    await settle(page);
    await clickMenu(page, 'Edit', 'Define Pattern');
    await settle(page);
    const [uiToast] = await toasts(page);
    expect(await runError(page, { op: 'pattern.define' })).toEqual({ code: 'refused', message: uiToast });
    expect(await patterns(page)).toEqual([]);
  });
});

test.describe('Edit > Define Brush... and brush.define', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
  });

  for (const [item, color] of [['Define Brush...', false], ['Define Color Brush...', true]] as const) {
    test(`brush.define color ${color} matches ${item} answered "Stamp": the same stroke then leaves the same pixels`, async ({ page }) => {
      page.on('dialog', (d) => void d.accept('Stamp'));
      const presets: Array<{ name: string | null; size: number | null }> = [];
      await compareUiAndApi(page, {
        setup: blackBlock,
        viaUi: async (p) => {
          await clickMenu(p, 'Edit', item);
          await expect.poll(async () => (await activePreset(p)).name).toBe('Stamp');
          const { name, size } = await activePreset(p);
          presets.push({ name, size });
          await strokeWithPreset(p);
        },
        viaApi: async (p) => {
          const result = await run<{ id: string; name: string }>(p, { op: 'brush.define', name: 'Stamp', color });
          const { id, name, size } = await activePreset(p);
          expect(id).toBe(result.id);
          presets.push({ name, size });
          await strokeWithPreset(p);
        },
      });
      expect(presets).toEqual([{ name: 'Stamp', size: 40 }, { name: 'Stamp', size: 40 }]);
    });
  }

  test('brush.define refuses without a selection, where the menu items are disabled', async ({ page }) => {
    await freshDocument(page);
    const before = await activePreset(page);
    expect(await runError(page, { op: 'brush.define', name: 'x' })).toEqual({
      code: 'refused', message: 'Nothing is selected: Define Brush needs a selection around the brush tip.',
    });
    expect(await activePreset(page)).toEqual(before);
  });

  for (const [item, color] of [['Define Brush...', false], ['Define Color Brush...', true]] as const) {
    test(`brush.define color ${color} refuses an empty tip with the text ${item} toasts`, async ({ page }) => {
      await freshDocument(page);
      await dragMarquee(page, 20, 20, 60, 50);
      await clickMenu(page, 'Edit', item);
      await expect.poll(async () => (await toasts(page)).length).toBe(1);
      const [uiToast] = await toasts(page);
      const before = await activePreset(page);
      expect(await runError(page, { op: 'brush.define', name: 'x', color })).toEqual({ code: 'refused', message: uiToast });
      expect(await activePreset(page)).toEqual(before);
    });
  }
});

test.describe('Quick Mask and quickmask.set', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the toolbox needs the desktop layout');
  });

  test('quickmask.set true, a stroke, false matches Q, the same stroke, Q: the same selection', async ({ page }) => {
    const results: unknown[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => dragMarquee(p, 40, 30, 160, 120),
      viaUi: async (p) => {
        await pressKey(p, 'q');
        expect(await maskMode(p)).toBe('quickMask');
        await brushStroke(p, STROKE, BLACK);
        await pressKey(p, 'q');
        await expect.poll(() => maskMode(p)).toBe('off');
        await settle(p, 300);
      },
      viaApi: async (p) => {
        results.push(await run(p, { op: 'quickmask.set', enabled: true }));
        expect(await maskMode(p)).toBe('quickMask');
        await brushStroke(p, STROKE, BLACK);
        results.push(await run(p, { op: 'quickmask.set', enabled: false }));
      },
    });
    expect(results[0]).toEqual({ enabled: true, selection: { active: false, bounds: null } });
    expect(results[1]).toEqual({ enabled: false, selection: { active: true, bounds: api.selection.bounds } });
    expect(api.selection.active).toBe(true);
    expect(api.history.undo).toEqual(['New Document', 'Quick Mask Paint']);
  });

  test('quickmask.set changes nothing when Quick Mask is already in that state', async ({ page }) => {
    await freshDocument(page);
    await dragMarquee(page, 40, 30, 160, 120);
    const before = (await surfaceState(page)).selection;
    expect(await run(page, { op: 'quickmask.set', enabled: false })).toEqual({ enabled: false, selection: before });
    expect(await maskMode(page)).toBe('off');
    await run(page, { op: 'quickmask.set', enabled: true });
    expect(await run(page, { op: 'quickmask.set', enabled: true })).toMatchObject({ enabled: true });
    expect(await maskMode(page)).toBe('quickMask');
  });
});
