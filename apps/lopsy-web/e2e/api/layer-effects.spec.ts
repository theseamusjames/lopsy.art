/**
 * `layer.effects`, `layer.rasterize` and `layer.rasterize-style`
 * (src/commands/layer/effects.ts, rasterize.ts): each against the Layer
 * Effects drawer or Layers panel control it stands for, then on its own for
 * the refusals.
 */
import { test, expect, run, runError, compareUiAndApi, snapshot, type Page } from './harness';
import { fillRect, historyLabels, settle, startTextEditing } from '../surface-helpers';
import { pressKey } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };

/** A red block on Layer 1 at (20,20)-(80,60), with the marquee dropped. */
async function paintLayer1(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 80, 60, RED);
  await pressKey(page, 'ControlOrMeta+d');
}

function drawer(page: Page) {
  return page.getByTestId('effects-drawer');
}

async function activeLayerName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string | null; layers: Array<{ id: string; name: string }> } };
    };
    const doc = store.getState().document;
    return doc.layers.find((l) => l.id === doc.activeLayerId)?.name ?? '';
  });
}

async function openDrawer(page: Page): Promise<void> {
  if (await drawer(page).isVisible()) return;
  await page.getByRole('button', { name: `Layer effects for ${await activeLayerName(page)}`, exact: true }).click();
  await expect(drawer(page).getByRole('listbox', { name: 'Layer effects' })).toBeVisible();
  await settle(page);
}

async function toggleEffect(page: Page, label: string): Promise<void> {
  await openDrawer(page);
  await drawer(page).getByRole('checkbox', { name: `Enable ${label}`, exact: true }).click();
  await settle(page);
}

/** Types into a slider's value box and commits it with Enter, as one drawer edit. */
async function setSlider(page: Page, label: string, value: number): Promise<void> {
  const input = drawer(page).getByRole('textbox', { name: `${label} value`, exact: true });
  await input.fill(String(value));
  await input.press('Enter');
  await settle(page);
}

async function setColor(page: Page, label: string, hex: string): Promise<void> {
  await drawer(page).getByLabel(label, { exact: true }).fill(hex);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
}

interface EffectCase {
  label: string;
  viaUi: (page: Page) => Promise<void>;
  patch: Record<string, unknown>;
  history: string[];
}

const CASES: EffectCase[] = [
  {
    label: 'Drop Shadow',
    viaUi: async (p) => {
      await toggleEffect(p, 'Drop Shadow');
      await setColor(p, 'Shadow color', '#00ff00');
      await setSlider(p, 'Offset X', -12);
      await setSlider(p, 'Blur', 3);
    },
    patch: { dropShadow: { enabled: true, color: '#00ff00', offsetX: -12, blur: 3 } },
    history: ['Enable Drop Shadow', 'Edit Drop Shadow', 'Edit Drop Shadow', 'Edit Drop Shadow'],
  },
  {
    label: 'Stroke',
    viaUi: async (p) => {
      await toggleEffect(p, 'Stroke');
      await setColor(p, 'Stroke color', '#0000ff');
      await setSlider(p, 'Width', 6);
      await drawer(p).getByRole('button', { name: 'Stroke position: center', exact: true }).click();
      await settle(p);
    },
    patch: { stroke: { enabled: true, color: '#0000ff', width: 6, position: 'center' } },
    history: ['Enable Stroke', 'Edit Stroke', 'Edit Stroke'],
  },
  {
    label: 'Outer Glow',
    viaUi: async (p) => {
      await toggleEffect(p, 'Outer Glow');
      await setColor(p, 'Glow color', '#ff00ff');
      await setSlider(p, 'Size', 20);
      await setSlider(p, 'Opacity', 40);
    },
    patch: { outerGlow: { enabled: true, color: '#ff00ff', size: 20, opacity: 40 } },
    history: ['Enable Outer Glow', 'Edit Outer Glow', 'Edit Outer Glow', 'Edit Outer Glow'],
  },
  {
    label: 'Inner Glow',
    viaUi: async (p) => {
      await toggleEffect(p, 'Inner Glow');
      await setColor(p, 'Glow color', '#00ffff');
      await setSlider(p, 'Size', 6);
      await setSlider(p, 'Spread', 2);
    },
    patch: { innerGlow: { enabled: true, color: '#00ffff', size: 6, spread: 2 } },
    history: ['Enable Inner Glow', 'Edit Inner Glow', 'Edit Inner Glow', 'Edit Inner Glow'],
  },
  {
    label: 'Color Overlay',
    viaUi: async (p) => {
      await toggleEffect(p, 'Color Overlay');
      await setColor(p, 'Overlay color', '#336699');
    },
    patch: { colorOverlay: { enabled: true, color: '#336699' } },
    history: ['Enable Color Overlay', 'Edit Color Overlay'],
  },
];

/** Commit a text layer "Hi" through the Text tool. */
async function addTextLayer(page: Page): Promise<void> {
  await startTextEditing(page, 100, 80, 'Hi');
  await page.keyboard.press('Shift+Enter');
  await settle(page);
}

function toolbarButton(page: Page, name: string) {
  return page.getByRole('toolbar', { name: 'Layer actions' }).getByRole('button', { name, exact: true });
}

test.describe('the Layer Effects drawer and the effects commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the effects drawer and Layers panel need the desktop layout');
  });

  for (const c of CASES) {
    test(`layer.effects matches enabling and editing ${c.label} in the drawer`, async ({ page }) => {
      let result: Record<string, Record<string, unknown>> = {};
      const { api } = await compareUiAndApi(page, {
        setup: paintLayer1,
        viaUi: c.viaUi,
        viaApi: async (p) => {
          result = await run(p, { op: 'layer.effects', ...c.patch });
        },
      });
      expect(api.history.undo.slice(-c.history.length)).toEqual(c.history);
      const [key, patch] = Object.entries(c.patch)[0]!;
      expect(result[key]).toMatchObject(patch as Record<string, unknown>);
    });
  }

  test('layer.effects leaves fields and effects it is not given as they were', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer1(p);
        await toggleEffect(p, 'Stroke');
        await setSlider(p, 'Width', 9);
      },
      viaUi: async (p) => {
        await toggleEffect(p, 'Drop Shadow');
        await setSlider(p, 'Spread', 5);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.effects', dropShadow: { enabled: true, spread: 5 } });
      },
    });
  });

  test('layer.effects with nothing changed adds no history', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    const before = await historyLabels(page);
    const result = await run<Record<string, Record<string, unknown>>>(page, { op: 'layer.effects', stroke: { width: 2, enabled: false } });
    expect(result.stroke).toEqual({ enabled: false, color: '#000000', width: 2, position: 'outside' });
    expect(await historyLabels(page)).toEqual(before);
  });

  test('layer.effects refuses a group, and rejects values outside the drawer\'s ranges', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    expect(await runError(page, { op: 'layer.effects', layer: 'Project', stroke: { enabled: true } })).toEqual({
      code: 'refused',
      message: '"Project" is a group: groups have no layer effects (their effects button opens the Adjustments drawer).',
    });
    expect(await runError(page, { op: 'layer.effects', stroke: { width: 301 } })).toEqual({
      code: 'invalid',
      message: 'layer.effects: stroke.width must be from 1 to 300 in this document, got 301',
    });
    expect((await runError(page, { op: 'layer.effects' })).code).toBe('invalid');
  });

  test('layer.rasterize matches the Rasterize Layer button on a text layer', async ({ page }) => {
    let result: { type?: string } = {};
    const { api } = await compareUiAndApi(page, {
      setup: addTextLayer,
      viaUi: async (p) => {
        await toolbarButton(p, 'Rasterize Layer').click();
        await settle(p);
      },
      viaApi: async (p) => {
        result = await run(p, { op: 'layer.rasterize' });
      },
    });
    expect(result.type).toBe('raster');
    expect(api.history.undo.at(-1)).toBe('Rasterize Layer');
    expect(api.layers.filter((l) => l.type === 'text')).toEqual([]);
  });

  test('layer.rasterize refuses a layer that is not text', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    expect(await runError(page, { op: 'layer.rasterize' })).toEqual({
      code: 'refused',
      message: '"Layer 1" is not a text layer: the Rasterize Layer button only shows for text layers.',
    });
  });

  test('layer.rasterize-style matches the drawer\'s Rasterize Layer Style button', async ({ page }) => {
    let before: string | null = null;
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer1(p);
        await toggleEffect(p, 'Stroke');
        await setSlider(p, 'Width', 4);
      },
      viaUi: async (p) => {
        await drawer(p).getByRole('button', { name: 'Rasterize Layer Style', exact: true }).click();
        await settle(p);
      },
      viaApi: async (p) => {
        before = (await snapshot(p)).layers[1]!.pixels;
        await run(p, { op: 'layer.rasterize-style' });
      },
    });
    expect(api.history.undo.at(-1)).toBe('Rasterize Layer Style');
    expect(api.layers[1]!.pixels).not.toBe(before);
    expect((api.layers[1]!.effects as { stroke: { enabled: boolean } }).stroke.enabled).toBe(false);
  });

  test('layer.rasterize-style refuses a layer with no enabled effects', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    expect(await runError(page, { op: 'layer.rasterize-style' })).toEqual({
      code: 'refused',
      message: '"Layer 1" has no enabled effects: the Rasterize Layer Style button is disabled.',
    });
  });
});
