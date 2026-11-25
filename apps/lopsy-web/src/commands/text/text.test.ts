// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GestureInput } from '../gesture/run-gesture';
import type { TextLayer } from '../../types';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// A named layer that is not active is acted on once the engine has settled (context.ts actOnLayer); there is no render loop here.
const settle = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../settled', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settled')>()),
  settled: () => {
    settle.calls++;
    return Promise.resolve();
  },
}));

const engine = { current: {} as unknown };
vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => engine.current };
});

const calls: string[] = [];
const fonts = vi.hoisted(() => ({ loaded: new Set<string>(['Inter']) }));
vi.mock('../../engine-wasm/wasm-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/wasm-bridge')>();
  return {
    ...actual,
    isFontLoaded: (_engine: unknown, family: string) => fonts.loaded.has(family),
    getLayerTextureDimensions: () => [40, 20],
  };
});

const gesture = vi.hoisted(() => ({ run: vi.fn<(input: GestureInput) => { tool: string; layer: string }>() }));
vi.mock('../gesture/run-gesture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gesture/run-gesture')>();
  return { ...actual, runGesture: gesture.run };
});

const text = vi.hoisted(() => ({
  hit: vi.fn((): unknown => null),
  commit: vi.fn(),
}));
vi.mock('../../tools/text/text-interaction', () => ({
  textLayerAt: text.hit,
  commitTextEditing: text.commit,
}));

const buffer = vi.hoisted(() => ({ insert: vi.fn(), selectAll: vi.fn() }));
vi.mock('../../app/text-edit-buffer', () => ({
  insertIntoEditedText: buffer.insert,
  selectAllEditedText: buffer.selectAll,
}));

const settings = vi.hoisted(() => ({
  family: vi.fn((): Promise<void> => Promise.resolve()),
  weight: vi.fn((): Promise<void> => Promise.resolve()),
  discrete: vi.fn((): Promise<void> => Promise.resolve()),
  apply: vi.fn((): Promise<void> => Promise.resolve()),
  begin: vi.fn(),
  end: vi.fn(),
}));
vi.mock('../../tools/text/apply-text-setting', () => ({
  applyTextFontFamily: settings.family,
  applyTextWeight: settings.weight,
  applyDiscreteTextSetting: settings.discrete,
  applyTextSetting: settings.apply,
  beginTextLayerHistory: settings.begin,
  endTextLayerHistory: settings.end,
}));

const color = vi.hoisted(() => ({ apply: vi.fn(), begin: vi.fn(), end: vi.fn() }));
vi.mock('../../tools/text/apply-text-color', () => ({
  applyTextColor: color.apply,
  beginTextColorPick: color.begin,
  endTextColorPick: color.end,
}));

vi.mock('../../app/interactions/gesture-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/interactions/gesture-session')>();
  return { ...actual, clearPersistentTransform: vi.fn() };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { createTextLayer } = await import('../../layers/layer-model');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const { FONT_WAIT_MS } = await import('./text');

const INHERITED_NAMES = ['toString', 'constructor', '__proto__', 'hasOwnProperty'] as const;

/** An object whose one own key is `name`, as JSON.parse makes it, even for __proto__. */
function ownKeyed(name: string): Record<string, unknown> {
  return JSON.parse(`{${JSON.stringify(name)}: 1}`) as Record<string, unknown>;
}

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

function addText(name: string, fontFamily = 'Inter, sans-serif'): TextLayer {
  const layer = { ...createTextLayer({ name, text: name, fontFamily, fontSize: 24, color: { r: 0, g: 0, b: 0, a: 1 } }), x: 10, y: 20 };
  useEditorStore.getState().addTextLayer(layer, { recordHistory: false });
  return layer;
}

function startEditing(layerId: string, isNew: boolean): void {
  useUIStore.getState().startTextEditing({
    layerId,
    bounds: { x: 0, y: 0, width: null, height: null },
    text: '',
    cursorPos: 0,
    selectionAnchor: null,
    isNew,
    originalVisible: true,
  });
}

beforeEach(() => {
  engine.current = null;
  useEditorStore.getState().createDocument(200, 100, false);
  engine.current = {};
  useUIStore.setState({ textEditing: null });
  calls.length = 0;
  fonts.loaded = new Set(['Inter']);
  gesture.run.mockReset().mockImplementation((input) => {
    calls.push(`gesture ${JSON.stringify(input.points)}`);
    const layer = addText('Text 1');
    startEditing(layer.id, true);
    return { tool: 'text', layer: layer.id };
  });
  text.hit.mockReset().mockReturnValue(null);
  text.commit.mockReset().mockImplementation(() => {
    calls.push('commit');
    useUIStore.setState({ textEditing: null });
  });
  buffer.insert.mockReset().mockImplementation((raw: string) => calls.push(`insert ${raw}`));
  buffer.selectAll.mockReset().mockImplementation(() => calls.push('selectAll'));
  for (const fn of [settings.family, settings.weight, settings.discrete, settings.apply]) fn.mockReset().mockResolvedValue(undefined);
  settings.begin.mockReset();
  settings.end.mockReset();
  for (const fn of [color.apply, color.begin, color.end]) fn.mockReset();
});

describe('text.add', () => {
  it('clicks with the Text tool, types and commits before its first await', async () => {
    const pending = runCommand('text.add', { x: 12.4, y: 30, text: 'Hi\nthere' });
    expect(calls).toEqual(['gesture [{"x":12.4,"y":30}]', 'insert Hi\nthere', 'commit']);
    expect(text.hit).toHaveBeenCalledWith({ x: 12, y: 30 });
    await expect(pending).resolves.toEqual({ id: expect.any(String), name: 'Text 1', fontLoaded: true });
  });

  it('resolves with fontLoaded false, not a failure, when the font never arrives: the layer is already made', async () => {
    gesture.run.mockImplementation(() => {
      const layer = addText('Text 1', 'Montserrat, sans-serif');
      startEditing(layer.id, true);
      return { tool: 'text', layer: layer.id };
    });
    vi.useFakeTimers();
    try {
      const pending = runCommand('text.add', { x: 10, y: 10, text: 'M' });
      await vi.advanceTimersByTimeAsync(FONT_WAIT_MS + 1000);
      await expect(pending).resolves.toEqual({ id: expect.any(String), name: 'Text 1', fontLoaded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses with a CommandError when the click opened no text box', async () => {
    gesture.run.mockImplementation(() => ({ tool: 'text', layer: 'none' }));
    expect(await failure(runCommand('text.add', { x: 1, y: 1, text: 'A' }))).toMatchObject({
      code: 'refused',
      message: 'text.add: the Text-tool click did not open a text box there, so nothing was typed.',
    });
    expect(calls).not.toContain('commit');
  });

  it('drags for box text', async () => {
    await runCommand('text.add', { x: 10, y: 10, text: 'Box', box: { width: 50, height: 20 } });
    expect(calls[0]).toBe('gesture [{"x":10,"y":10},{"x":60,"y":30}]');
  });

  it('waits until a web font the layer uses reaches the engine', async () => {
    gesture.run.mockImplementation(() => {
      const layer = addText('Text 1', 'Montserrat, sans-serif');
      startEditing(layer.id, true);
      return { tool: 'text', layer: layer.id };
    });
    let isDone = false;
    const pending = runCommand('text.add', { x: 10, y: 10, text: 'M' }).then(() => { isDone = true; });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(isDone).toBe(false);
    fonts.loaded.add('Montserrat');
    await pending;
    expect(isDone).toBe(true);
  });

  it('refuses whitespace, an edit in progress and a point on an existing text layer', async () => {
    expect(await failure(runCommand('text.add', { x: 1, y: 1, text: ' \n ' }))).toMatchObject({ code: 'invalid' });
    const existing = addText('Hello');
    text.hit.mockReturnValueOnce(existing);
    expect(await failure(runCommand('text.add', { x: 1, y: 1, text: 'A' }))).toMatchObject({
      code: 'refused',
      message: 'A Text-tool click at (1, 1) would edit the text layer "Hello" instead of adding one: use text.edit, or pick a point outside it.',
    });
    startEditing(existing.id, false);
    expect(await failure(runCommand('text.add', { x: 1, y: 1, text: 'A' }))).toMatchObject({ code: 'refused', message: 'Text is being edited: commit it first (for example with tool.select).' });
    expect(gesture.run).not.toHaveBeenCalled();
  });

  it('rejects a box of 4 px or less', async () => {
    expect((await failure(runCommand('text.add', { x: 1, y: 1, text: 'A', box: { width: 4, height: 10 } }))).code).toBe('invalid');
  });
});

describe('text.edit', () => {
  it('clicks inside the layer, selects all, types and commits', async () => {
    const layer = addText('Hello');
    text.hit.mockReturnValue(layer);
    gesture.run.mockImplementation((input) => {
      calls.push(`gesture ${JSON.stringify(input.points)}`);
      startEditing(layer.id, false);
      return { tool: 'text', layer: layer.id };
    });
    const pending = runCommand('text.edit', { layer: 'Hello', text: 'Bye' });
    expect(calls).toEqual(['gesture [{"x":30,"y":30}]', 'selectAll', 'insert Bye', 'commit']);
    await expect(pending).resolves.toEqual({ id: layer.id, name: 'Hello', fontLoaded: true });
  });

  it('refuses a raster layer and a layer a click cannot reach', async () => {
    expect(await failure(runCommand('text.edit', { text: 'x' }))).toMatchObject({ code: 'refused', message: '"Layer 1" is not a text layer.' });
    addText('Hidden');
    expect(await failure(runCommand('text.edit', { layer: 'Hidden', text: 'x' }))).toMatchObject({ code: 'refused' });
    expect(gesture.run).not.toHaveBeenCalled();
  });
});

describe('text.set-font', () => {
  it('picks the family as the picker does, then the weight and style that differ, and waits for them', async () => {
    fonts.loaded.add('Montserrat');
    const pending = runCommand('text.set-font', { family: 'Montserrat', weight: 700, style: 'italic' });
    expect(settings.family).toHaveBeenCalledWith('Montserrat, sans-serif');
    expect(settings.weight).toHaveBeenCalledWith(700);
    expect(settings.discrete).toHaveBeenCalledWith('fontStyle', 'italic');
    await expect(pending).resolves.toMatchObject({ weight: expect.any(Number) });
  });

  it('resolves with fontLoaded false when the font never arrives, the setting already applied', async () => {
    vi.useFakeTimers();
    try {
      const pending = runCommand('text.set-font', { family: 'Montserrat' });
      expect(settings.family).toHaveBeenCalledWith('Montserrat, sans-serif');
      await vi.advanceTimersByTimeAsync(FONT_WAIT_MS + 1000);
      await expect(pending).resolves.toMatchObject({ fontLoaded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('quotes a family with a space, and skips an unchanged weight', async () => {
    fonts.loaded.add('IM Fell English');
    await runCommand('text.set-font', { family: 'IM Fell English', weight: 400 });
    expect(settings.family).toHaveBeenCalledWith("'IM Fell English', serif");
    expect(settings.weight).not.toHaveBeenCalled();
  });

  it('refuses a family the picker does not list and a weight it does not offer', async () => {
    expect(await failure(runCommand('text.set-font', { family: 'No Such Font' }))).toMatchObject({ code: 'refused' });
    expect(await failure(runCommand('text.set-font', { family: 'Inter', weight: 450 }))).toMatchObject({
      code: 'invalid',
      message: 'text.set-font: Inter offers the weights 100, 200, 300, 400, 500, 600, 700, 800, 900, not 450.',
    });
    expect(settings.family).not.toHaveBeenCalled();
  });
});

describe('text.style', () => {
  it('makes the layer active, and once the engine has settled applies each changed option as its control does', async () => {
    const layer = addText('Hello');
    useEditorStore.getState().setActiveLayer(useEditorStore.getState().document.layers[1]!.id);
    const settles = settle.calls;
    const pending = runCommand('text.style', { layer: 'Hello', options: { fontSize: 50, align: 'center', underline: false } });
    expect(useEditorStore.getState().document.activeLayerId).toBe(layer.id);
    expect(settle.calls).toBe(settles + 1);
    expect(settings.begin).not.toHaveBeenCalled();
    await pending;
    expect(settings.begin).toHaveBeenCalledTimes(1);
    expect(settings.apply).toHaveBeenCalledWith('fontSize', 50);
    expect(settings.end).toHaveBeenCalledTimes(1);
    expect(settings.discrete).toHaveBeenCalledWith('align', 'center');
    expect(settings.discrete).not.toHaveBeenCalledWith('underline', false);
    await expect(pending).resolves.toMatchObject({ id: layer.id, name: 'Hello' });
  });

  it('applies the options in the caller\'s tick, with no wait, when the layer is already active', async () => {
    const layer = addText('Hello');
    useEditorStore.getState().setActiveLayer(layer.id);
    const settles = settle.calls;
    const pending = runCommand('text.style', { options: { fontSize: 50 } });
    expect(settings.apply).toHaveBeenCalledWith('fontSize', 50);
    expect(settle.calls).toBe(settles);
    await expect(pending).resolves.toMatchObject({ id: layer.id });
  });

  it('is invalid for names Object.prototype has, which are no options', async () => {
    addText('Hello');
    for (const name of INHERITED_NAMES) {
      const error = await failure(runCommand('text.style', { layer: 'Hello', options: ownKeyed(name) }));
      expect([error.code, error.message]).toEqual(['invalid', expect.stringContaining(`unknown option ${JSON.stringify(name)}`)]);
    }
    expect(settings.discrete).not.toHaveBeenCalled();
    expect(settings.apply).not.toHaveBeenCalled();
  });

  it('refuses a raster layer and rejects unknown or out-of-range options', async () => {
    expect(await failure(runCommand('text.style', { options: { align: 'left' } }))).toMatchObject({ code: 'refused' });
    expect(await failure(runCommand('text.style', { options: { fontFamily: 'Inter' } }))).toMatchObject({ code: 'invalid' });
    expect(await failure(runCommand('text.style', { options: { fontSize: 0 } }))).toMatchObject({
      code: 'invalid',
      message: expect.stringMatching(/^text\.style: options\.fontSize must be from 1 to /),
    });
  });
});

describe('text.style with the Text panel\'s sliders', () => {
  it('brackets lineHeight, letterSpacing and paragraphSpacing each in its own history, as the sliders do', async () => {
    const layer = addText('Hello');
    useEditorStore.getState().setActiveLayer(layer.id);
    const order: string[] = [];
    settings.begin.mockImplementation(() => order.push('begin'));
    settings.apply.mockImplementation((...args: unknown[]) => {
      order.push(`apply ${args.join(' ')}`);
      return Promise.resolve();
    });
    settings.end.mockImplementation(() => order.push('end'));
    await runCommand('text.style', { options: { lineHeight: 2, letterSpacing: -4.5, paragraphSpacing: 30 } });
    expect(order).toEqual([
      'begin', 'apply lineHeight 2', 'end',
      'begin', 'apply letterSpacing -4.5', 'end',
      'begin', 'apply paragraphSpacing 30', 'end',
    ]);
    expect(settings.discrete).not.toHaveBeenCalled();
  });

  it('takes the sliders\' ranges', async () => {
    const layer = addText('Hello');
    useEditorStore.getState().setActiveLayer(layer.id);
    for (const options of [{ lineHeight: 0.4 }, { lineHeight: 4.1 }, { letterSpacing: -21 }, { letterSpacing: 201 }, { paragraphSpacing: -1 }, { paragraphSpacing: 201 }]) {
      expect((await failure(runCommand('text.style', { options }))).code).toBe('invalid');
    }
    expect(settings.apply).not.toHaveBeenCalled();
  });
});

describe('text.set-color', () => {
  it('makes the layer active, then picks the colour once as the text colour control does, leaving the foreground alone', async () => {
    const layer = addText('Hello');
    useEditorStore.getState().setActiveLayer(useEditorStore.getState().document.layers[1]!.id);
    const { useToolSettingsStore } = await import('../../app/tool-settings-store');
    const foreground = useToolSettingsStore.getState().foregroundColor;
    const order: string[] = [];
    color.begin.mockImplementation(() => order.push('begin'));
    color.apply.mockImplementation((c: unknown) => {
      order.push('apply');
      expect(useEditorStore.getState().document.activeLayerId).toBe(layer.id);
      useEditorStore.getState().updateTextLayerProperties(layer.id, { color: c as TextLayer['color'] });
    });
    color.end.mockImplementation(() => order.push('end'));
    const result = await runCommand('text.set-color', { layer: 'Hello', color: '#ff8000' });
    expect(order).toEqual(['begin', 'apply', 'end']);
    expect(color.apply).toHaveBeenCalledWith({ r: 255, g: 128, b: 0, a: 1 });
    expect(result).toEqual({ id: layer.id, name: 'Hello', color: '#ff8000' });
    expect(useToolSettingsStore.getState().foregroundColor).toEqual(foreground);
  });

  it('does nothing when the layer already has the colour throughout, and picks when ranges hold others', async () => {
    const layer = addText('Hello');
    useEditorStore.getState().setActiveLayer(layer.id);
    expect(await runCommand('text.set-color', { color: '#000' })).toMatchObject({ color: '#000000' });
    expect(color.begin).not.toHaveBeenCalled();
    useEditorStore.getState().updateTextLayerProperties(layer.id, { colorSpans: [{ start: 0, end: 2, color: { r: 255, g: 0, b: 0, a: 1 } }] });
    await runCommand('text.set-color', { color: '#000000' });
    expect(color.apply).toHaveBeenCalledTimes(1);
  });

  it('refuses a raster layer and text being edited, and rejects a colour that is not hex', async () => {
    expect(await failure(runCommand('text.set-color', { color: '#ffffff' }))).toMatchObject({ code: 'refused', message: '"Layer 1" is not a text layer.' });
    const layer = addText('Hello');
    startEditing(layer.id, false);
    expect(await failure(runCommand('text.set-color', { layer: 'Hello', color: '#ffffff' }))).toMatchObject({
      code: 'refused', message: 'Text is being edited: commit it first (for example with tool.select).',
    });
    expect((await failure(runCommand('text.set-color', { layer: 'Hello', color: 'red' }))).code).toBe('invalid');
    expect(color.apply).not.toHaveBeenCalled();
  });
});

describe('text.fonts', () => {
  it('lists the picker\'s catalogue alphabetically with the total, and works with no document open', async () => {
    const { FONT_CATALOG } = await import('../../utils/font-catalog');
    useEditorStore.setState({ documentReady: false });
    const all = (await runCommand('text.fonts', { limit: FONT_CATALOG.length })) as { total: number; fonts: Array<{ family: string }> };
    expect(all.total).toBe(FONT_CATALOG.length);
    const families = all.fonts.map((f) => f.family);
    expect(families).toEqual([...families].sort((a, b) => a.localeCompare(b)));
    const first = (await runCommand('text.fonts', {})) as { total: number; fonts: unknown[] };
    expect([first.total, first.fonts.length]).toEqual([FONT_CATALOG.length, 50]);
  });

  it('filters by category and a case-insensitive substring, and gives each family\'s weights and italic', async () => {
    const result = (await runCommand('text.fonts', { query: 'MONTSERRAT', category: 'sans-serif' })) as {
      total: number;
      fonts: Array<{ family: string; category: string; weights: number[]; hasItalic: boolean }>;
    };
    expect(result.fonts.map((f) => f.family)).toContain('Montserrat');
    expect(result.total).toBe(result.fonts.length);
    for (const font of result.fonts) {
      expect(font.family.toLowerCase()).toContain('montserrat');
      expect(font.category).toBe('sans-serif');
    }
    expect(result.fonts.find((f) => f.family === 'Montserrat')).toMatchObject({ hasItalic: true, weights: expect.arrayContaining([400, 700]) });
    expect(((await runCommand('text.fonts', { query: 'no such family' })) as { total: number }).total).toBe(0);
    expect((await failure(runCommand('text.fonts', { category: 'script' }))).code).toBe('invalid');
  });
});
