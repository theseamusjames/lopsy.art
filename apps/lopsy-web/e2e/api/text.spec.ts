/**
 * The text commands (src/commands/text/text.ts) against the Text tool, its
 * options bar and the font picker, with web fonts served offline from the
 * fixtures on both sides (font-fixtures.ts), then on their own for each
 * refusal.
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { serveFontsOffline } from '../font-fixtures';
import { docToScreen, setForegroundColor, setToolOption } from '../helpers';
import { clickMenu, historyLabels, settle } from '../surface-helpers';
import { blurFocus, pressKey } from '../surface-helpers-keys';

// The offline font routes answer jsDelivr with 404, as it does for families it has no file for.
test.use({ allowConsoleErrors: [/Failed to load resource/] });

interface TextProps {
  name: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: string;
  textAlign: string;
  color: unknown;
  width: number | null;
  x: number;
  y: number;
  transform: unknown;
}

interface RenderResult {
  base64: string;
}

/** Every text layer's text properties, bottom to top. */
async function textProps(page: Page): Promise<TextProps[]> {
  return page.evaluate(() => {
    type T = TextProps & { type: string; id: string };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: T[]; layerOrder: string[] } };
    };
    const { layers, layerOrder } = store.getState().document;
    return layerOrder
      .map((id) => layers.find((l) => l.id === id))
      .filter((l): l is T => l?.type === 'text')
      .map((l) => ({
        name: l.name, text: l.text, fontFamily: l.fontFamily, fontSize: l.fontSize, fontWeight: l.fontWeight,
        fontStyle: l.fontStyle, textAlign: l.textAlign, color: l.color, width: l.width ?? null, x: l.x, y: l.y,
        transform: l.transform ?? null,
      }));
  });
}

async function textRect(page: Page, name: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(async (layerName) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; name: string; x: number; y: number }> } } };
    const layer = store.getState().document.layers.find((l) => l.name === layerName);
    if (!layer) throw new Error(`no layer ${layerName}`);
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number }>;
    const { width, height } = await read(layer.id);
    return { x: layer.x, y: layer.y, width, height };
  }, name);
}

async function waitForFont(page: Page, family: string): Promise<void> {
  await page.waitForFunction(
    (f) => ((window as unknown as Record<string, unknown>).__isFontLoaded as (f: string) => boolean)(f),
    family,
    { timeout: 20_000 },
  );
  await settle(page, 500);
}

async function offlineAtActualSize(page: Page): Promise<void> {
  await serveFontsOffline(page);
  await clickMenu(page, 'View', 'Actual Size');
  await settle(page);
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const at = await docToScreen(page, x, y);
  await page.mouse.click(at.x, at.y);
  await settle(page, 100);
}

async function dragDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await settle(page, 100);
}

/** With the Text tool: click (or drag), type `lines` with Enter between them, commit with Tab. */
async function typeAndTab(page: Page, lines: readonly string[]): Promise<void> {
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.keyboard.press('Tab');
  await settle(page, 300);
}

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await settle(page, 200);
}

async function render(page: Page): Promise<string> {
  return (await run<RenderResult>(page, { op: 'view.render' })).base64;
}

async function uiText(page: Page, x: number, y: number, lines: readonly string[]): Promise<void> {
  await pressKey(page, 't');
  await clickDoc(page, x, y);
  await typeAndTab(page, lines);
}

test.describe('the text commands against the Text tool', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the options bar and Layers panel need the desktop layout');
  });

  test('text.add matches a click, typing and Tab', async ({ page }) => {
    const results: unknown[] = [];
    const props: TextProps[][] = [];
    const { api: after } = await compareUiAndApi(page, {
      width: 300, height: 200,
      setup: offlineAtActualSize,
      viaUi: async (p) => {
        await uiText(p, 40, 60, ['Hello']);
        props.push(await textProps(p));
      },
      viaApi: async (p) => {
        results.push(await run(p, { op: 'text.add', x: 40, y: 60, text: 'Hello' }));
        await settle(p, 300);
        props.push(await textProps(p));
      },
    });
    expect(results).toEqual([{ id: expect.any(String), name: 'Hello', fontLoaded: true }]);
    expect(props[1]).toEqual(props[0]);
    expect(props[1]?.[0]).toMatchObject({ name: 'Hello', text: 'Hello', width: null });
    expect(after.history.undo).toEqual(['New Document', 'Add Text Layer', 'Text']);
  });

  test('text.add with a line break matches Enter between typed lines', async ({ page }) => {
    const props: TextProps[][] = [];
    await compareUiAndApi(page, {
      width: 300, height: 200,
      setup: offlineAtActualSize,
      viaUi: async (p) => {
        await uiText(p, 30, 40, ['Line one', 'Line two']);
        props.push(await textProps(p));
      },
      viaApi: async (p) => {
        await run(p, { op: 'text.add', x: 30, y: 40, text: 'Line one\nLine two' });
        await settle(p, 300);
        props.push(await textProps(p));
      },
    });
    expect(props[1]).toEqual(props[0]);
    expect(props[1]?.[0]?.text).toBe('Line one\nLine two');
  });

  test('text.add with a box matches a Text-tool drag', async ({ page }) => {
    const props: TextProps[][] = [];
    await compareUiAndApi(page, {
      width: 300, height: 200,
      setup: offlineAtActualSize,
      viaUi: async (p) => {
        await pressKey(p, 't');
        await dragDoc(p, { x: 30, y: 40 }, { x: 150, y: 110 });
        await typeAndTab(p, ['Some words that wrap inside the box']);
        props.push(await textProps(p));
      },
      viaApi: async (p) => {
        await run(p, { op: 'text.add', x: 30, y: 40, box: { width: 120, height: 70 }, text: 'Some words that wrap inside the box' });
        await settle(p, 300);
        props.push(await textProps(p));
      },
    });
    expect(props[1]).toEqual(props[0]);
    expect(props[1]?.[0]?.width).toBe(120);
  });

  test('text.set-font + tool.set + color.set then text.add match the options bar, and the glyphs are final when text.add resolves', async ({ page }) => {
    const props: TextProps[][] = [];
    const renders: string[] = [];
    const { api: after } = await compareUiAndApi(page, {
      width: 300, height: 200,
      setup: offlineAtActualSize,
      viaUi: async (p) => {
        await pressKey(p, 't');
        await selectFont(p, 'Montserrat');
        await p.locator('select[aria-label="Font weight"]').selectOption('700');
        await setToolOption(p, 'Size', 40);
        await setForegroundColor(p, 200, 30, 60);
        await waitForFont(p, 'Montserrat');
        await blurFocus(p);
        await clickDoc(p, 30, 50);
        await typeAndTab(p, ['Bold']);
        await waitForFont(p, 'Montserrat');
        props.push(await textProps(p));
        renders.push(await render(p));
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'text.set-font', family: 'Montserrat', weight: 700 })).toEqual({ family: 'Montserrat', weight: 700, style: 'normal', fontLoaded: true });
        await run(p, { op: 'tool.set', tool: 'text', options: { fontSize: 40 } });
        await run(p, { op: 'color.set', foreground: '#c81e3c' });
        await run(p, { op: 'text.add', x: 30, y: 50, text: 'Bold' });
        renders.push(await render(p));
        props.push(await textProps(p));
      },
    });
    expect(props[1]).toEqual(props[0]);
    expect(props[1]?.[0]).toMatchObject({ fontFamily: 'Montserrat, sans-serif', fontWeight: 700, fontSize: 40 });
    expect(renders[1]).toBe(renders[0]);
    expect(after.history.undo).toEqual(['New Document', 'Add Text Layer', 'Text']);
  });

  test('text.edit matches a click inside the text, Cmd+A, typing and Tab', async ({ page }) => {
    const props: TextProps[][] = [];
    const { api: after } = await compareUiAndApi(page, {
      width: 300, height: 200,
      setup: async (p) => {
        await offlineAtActualSize(p);
        await uiText(p, 40, 60, ['Hello']);
      },
      viaUi: async (p) => {
        const rect = await textRect(p, 'Hello');
        await clickDoc(p, Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
        await p.keyboard.press('ControlOrMeta+a');
        await typeAndTab(p, ['Goodbye']);
        props.push(await textProps(p));
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'text.edit', layer: 'Hello', text: 'Goodbye' })).toEqual({ id: expect.any(String), name: 'Goodbye', fontLoaded: true });
        await settle(p, 300);
        props.push(await textProps(p));
      },
    });
    expect(props[1]).toEqual(props[0]);
    expect(props[1]?.[0]).toMatchObject({ name: 'Goodbye', text: 'Goodbye' });
    expect(after.history.undo).toEqual(['New Document', 'Add Text Layer', 'Text', 'Text']);
  });

  test('text.style matches the options bar Size and Align with the text layer active', async ({ page }) => {
    const props: TextProps[][] = [];
    const { api: after } = await compareUiAndApi(page, {
      width: 300, height: 200,
      setup: async (p) => {
        await offlineAtActualSize(p);
        await uiText(p, 40, 60, ['Hello there']);
      },
      viaUi: async (p) => {
        await setToolOption(p, 'Size', 48);
        await p.locator('select[aria-labelledby="text-align-label"]').selectOption('center');
        await settle(p, 300);
        props.push(await textProps(p));
      },
      viaApi: async (p) => {
        const result = await run<{ options: Record<string, unknown> }>(p, { op: 'text.style', options: { fontSize: 48, align: 'center' } });
        expect(result.options).toMatchObject({ fontSize: 48, align: 'center' });
        await settle(p, 300);
        props.push(await textProps(p));
      },
    });
    expect(props[1]).toEqual(props[0]);
    expect(props[1]?.[0]).toMatchObject({ fontSize: 48, textAlign: 'center' });
    expect(after.history.undo).toEqual(['New Document', 'Add Text Layer', 'Text', 'Text', 'Text']);
  });
});


/** The Text panel's spacing settings and the colour of every text layer, bottom to top. */
async function textExtras(page: Page): Promise<Array<{ lineHeight: number; letterSpacing: number; paragraphSpacing: number; color: unknown; colorSpans: unknown }>> {
  return page.evaluate(() => {
    type T = { type: string; id: string; lineHeight: number; letterSpacing: number; paragraphSpacing: number; color: unknown; colorSpans?: unknown };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: T[]; layerOrder: string[] } };
    };
    const { layers, layerOrder } = store.getState().document;
    return layerOrder
      .map((id) => layers.find((l) => l.id === id))
      .filter((l): l is T => l?.type === 'text')
      .map((l) => ({ lineHeight: l.lineHeight, letterSpacing: l.letterSpacing, paragraphSpacing: l.paragraphSpacing, color: l.color, colorSpans: l.colorSpans ?? [] }));
  });
}

async function openTextPanel(page: Page): Promise<void> {
  const value = page.locator('[aria-label="Line height value"]');
  if (!(await value.isVisible())) await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
  await expect(value).toBeVisible();
}

/** Types a value into a Text panel slider's box and commits it with Enter, as text-panel.spec does. */
async function setPanelSlider(page: Page, label: string, value: number): Promise<void> {
  const input = page.locator(`[data-panel="text"] [aria-label="${label} value"]`);
  await input.fill(String(value));
  await input.press('Enter');
  await blurFocus(page);
  await settle(page, 200);
}

test.describe('the Text panel and the text colour control, and text.style and text.set-color', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the options bar and Text panel need the desktop layout');
  });

  test('text.style with lineHeight, letterSpacing and paragraphSpacing matches the Text panel\'s sliders', async ({ page }) => {
    const extras: Array<Awaited<ReturnType<typeof textExtras>>> = [];
    const { api } = await compareUiAndApi(page, {
      width: 300, height: 200,
      setup: async (p) => {
        await offlineAtActualSize(p);
        await uiText(p, 40, 40, ['Line one', 'Line two']);
      },
      viaUi: async (p) => {
        await openTextPanel(p);
        await setPanelSlider(p, 'Line height', 2.2);
        await setPanelSlider(p, 'Letter spacing', 6.5);
        await setPanelSlider(p, 'Paragraph spacing', 12);
        extras.push(await textExtras(p));
      },
      viaApi: async (p) => {
        const result = await run<{ options: Record<string, unknown> }>(p, {
          op: 'text.style', options: { lineHeight: 2.2, letterSpacing: 6.5, paragraphSpacing: 12 },
        });
        expect(result.options).toMatchObject({ lineHeight: 2.2, letterSpacing: 6.5, paragraphSpacing: 12 });
        extras.push(await textExtras(p));
      },
    });
    expect(extras[1]).toEqual(extras[0]);
    expect(extras[1]?.[0]).toMatchObject({ lineHeight: 2.2, letterSpacing: 6.5, paragraphSpacing: 12 });
    expect(api.history.undo).toEqual(['New Document', 'Add Text Layer', 'Text', 'Text', 'Text', 'Text']);
  });

  test('text.set-color matches a hex typed into the options bar\'s Text color picker, and leaves the foreground alone', async ({ page }) => {
    const extras: Array<Awaited<ReturnType<typeof textExtras>>> = [];
    const { api } = await compareUiAndApi(page, {
      width: 300, height: 200,
      withEditorState: true,
      setup: async (p) => {
        await offlineAtActualSize(p);
        await uiText(p, 40, 60, ['Colour me']);
      },
      viaUi: async (p) => {
        const swatch = p.getByRole('button', { name: 'Text color', exact: true });
        await swatch.click();
        const field = p.getByRole('dialog', { name: 'Text color picker' }).getByLabel('Hex color');
        await field.fill('2A9D8F');
        await field.press('Enter');
        await swatch.click();
        await settle(p, 300);
        extras.push(await textExtras(p));
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'text.set-color', color: '#2a9d8f' })).toMatchObject({ name: 'Colour me', color: '#2a9d8f' });
        await settle(p, 300);
        extras.push(await textExtras(p));
      },
    });
    expect(extras[1]).toEqual(extras[0]);
    expect(extras[1]?.[0]?.color).toEqual({ r: 42, g: 157, b: 143, a: 1 });
    expect(api.editor.foreground).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(api.history.undo).toEqual(['New Document', 'Add Text Layer', 'Text', 'Text']);
  });
});

test.describe('the text commands on their own', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the options bar needs the desktop layout');
    await run(page, { op: 'doc.new', width: 300, height: 200 });
    await page.waitForSelector('[data-testid="canvas-container"]');
    await settle(page, 300);
  });

  test('text.add waits for a font still loading, so the render it resolves before is final', async ({ page }) => {
    await serveFontsOffline(page, 1500);
    await clickMenu(page, 'View', 'Actual Size');
    await pressKey(page, 't');
    await selectFont(page, 'IM Fell English');
    const loadedBefore = await page.evaluate(() => ((window as unknown as Record<string, unknown>).__isFontLoaded as (f: string) => boolean)('IM Fell English'));
    expect(loadedBefore).toBe(false);
    await run(page, { op: 'text.add', x: 30, y: 60, text: 'Fell' });
    expect(await page.evaluate(() => ((window as unknown as Record<string, unknown>).__isFontLoaded as (f: string) => boolean)('IM Fell English'))).toBe(true);
    const first = await render(page);
    await settle(page, 1000);
    expect(await render(page)).toBe(first);
  });

  test('text.set-color recolours a layer that is not active, making it active first, in one "Text" step', async ({ page }) => {
    await run(page, { op: 'text.add', x: 40, y: 60, text: 'Teal' });
    await run(page, { op: 'layer.select', layer: 'Background' });
    const before = await render(page);
    const history = await historyLabels(page);
    expect(await run(page, { op: 'text.set-color', layer: 'Teal', color: '#2a9d8f80' })).toMatchObject({ name: 'Teal', color: '#2a9d8f80' });
    expect(await render(page)).not.toBe(before);
    expect(await historyLabels(page)).toEqual([...history, 'Text']);
    expect(await run(page, { op: 'text.set-color', layer: 'Teal', color: '#2a9d8f80' })).toMatchObject({ color: '#2a9d8f80' });
    expect(await historyLabels(page)).toEqual([...history, 'Text']);
    const active = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string | null; layers: Array<{ id: string; name: string }> } };
      };
      const { document: doc } = store.getState();
      return doc.layers.find((l) => l.id === doc.activeLayerId)?.name;
    });
    expect(active).toBe('Teal');
  });

  test('text.style with letterSpacing widens the text it re-renders', async ({ page }) => {
    await run(page, { op: 'text.add', x: 40, y: 60, text: 'Wide' });
    const narrow = await textRect(page, 'Wide');
    await run(page, { op: 'text.style', options: { letterSpacing: 30 } });
    const wide = await textRect(page, 'Wide');
    expect(wide.width).toBeGreaterThan(narrow.width + 60);
    expect((await runError(page, { op: 'text.style', options: { lineHeight: 5 } })).code).toBe('invalid');
  });

  test('text.fonts lists the font picker\'s catalogue, filtered, with no document needed', async ({ page }) => {
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__lopsyCommands);
    const all = await run<{ total: number; fonts: Array<{ family: string; category: string; weights: number[]; hasItalic: boolean }> }>(page, { op: 'text.fonts' });
    expect(all.total).toBeGreaterThan(1500);
    expect(all.fonts).toHaveLength(50);
    const mono = await run<typeof all>(page, { op: 'text.fonts', category: 'monospace', query: 'mono', limit: 500 });
    expect(mono.fonts.map((f) => f.family)).toContain('JetBrains Mono');
    expect(mono.fonts.every((f) => f.category === 'monospace' && f.family.toLowerCase().includes('mono'))).toBe(true);
    expect(mono.total).toBe(mono.fonts.length);
    expect(mono.fonts.find((f) => f.family === 'JetBrains Mono')).toMatchObject({ hasItalic: true, weights: expect.arrayContaining([400, 700]) });
  });

  test('refusals', async ({ page }) => {
    expect(await runError(page, { op: 'text.add', x: 40, y: 60, text: '  ' })).toEqual({ code: 'invalid', message: 'text.add: text is empty or only whitespace, which a commit discards.' });
    expect(await runError(page, { op: 'text.edit', layer: 'Layer 1', text: 'x' })).toEqual({ code: 'refused', message: '"Layer 1" is not a text layer.' });
    expect(await runError(page, { op: 'text.set-color', layer: 'Layer 1', color: '#ff0000' })).toEqual({ code: 'refused', message: '"Layer 1" is not a text layer.' });
    expect(await runError(page, { op: 'text.set-font', family: 'No Such Font' })).toMatchObject({ code: 'refused' });
    expect(await runError(page, { op: 'text.set-font', family: 'Inter', weight: 450 })).toEqual({ code: 'invalid', message: 'text.set-font: Inter offers the weights 100, 200, 300, 400, 500, 600, 700, 800, 900, not 450.' });
    await run(page, { op: 'text.add', x: 40, y: 60, text: 'Hello' });
    expect((await runError(page, { op: 'text.style', options: { fontFamily: 'Inter' } })).code).toBe('invalid');
    expect(await runError(page, { op: 'text.style', options: { fontSize: 0 } })).toMatchObject({ code: 'invalid' });
    const rect = await textRect(page, 'Hello');
    const inside = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    expect(await runError(page, { op: 'text.add', ...inside, text: 'Again' })).toEqual({
      code: 'refused',
      message: `A Text-tool click at (${inside.x}, ${inside.y}) would edit the text layer "Hello" instead of adding one: use text.edit, or pick a point outside it.`,
    });
    await clickDoc(page, 200, 150);
    await page.keyboard.type('Draft');
    expect(await runError(page, { op: 'text.add', x: 20, y: 160, text: 'More' })).toEqual({ code: 'refused', message: 'Text is being edited: commit it first (for example with tool.select).' });
    expect((await runError(page, { op: 'text.edit', layer: 'Hello', text: 'More' })).code).toBe('refused');
    expect((await runError(page, { op: 'text.style', layer: 'Hello', options: { fontSize: 30 } })).code).toBe('refused');
    expect(await runError(page, { op: 'text.set-color', layer: 'Hello', color: '#ff0000' })).toEqual({ code: 'refused', message: 'Text is being edited: commit it first (for example with tool.select).' });
    await page.keyboard.press('Escape');
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Text Layer', 'Text']);
  });
});
