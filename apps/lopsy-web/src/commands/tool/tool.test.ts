// @vitest-environment jsdom
import '../../test/canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { DEFAULT_TOOL_SETTINGS_SLICES } = await import('../../app/tool-settings-slices');
const { toolRegistry } = await import('../../tools/tool-registry');
const { CommandError } = await import('../command');
const { runCommand, getCommand } = await import('../registry');
const { SELECTABLE_TOOLS } = await import('./tool');
const { TOOL_OPTIONS } = await import('./tool-options');

const realSetActiveTool = useUIStore.getState().setActiveTool;

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

function settings() {
  return useToolSettingsStore.getState().settings;
}

function labels(): string[] {
  return useEditorStore.getState().undoStack.map((e) => e.label);
}

beforeEach(() => {
  useEditorStore.getState().createDocument(400, 300, false);
  useEditorStore.getState().pushHistory('New Document');
  useToolSettingsStore.setState({ settings: DEFAULT_TOOL_SETTINGS_SLICES });
  useUIStore.setState({ setActiveTool: realSetActiveTool });
  useUIStore.getState().setActiveTool('move');
});

afterEach(() => {
  useUIStore.setState({ setActiveTool: realSetActiveTool });
});

describe('the tool table', () => {
  it('lists every tool with a handler, and has an entry for each', () => {
    const withHandler = Object.values(toolRegistry).filter((d) => d.handler).map((d) => d.id);
    expect([...SELECTABLE_TOOLS].sort()).toEqual([...withHandler].sort());
    for (const id of SELECTABLE_TOOLS) expect(TOOL_OPTIONS[id]).toBeDefined();
  });

  it('reads every option as JSON', async () => {
    for (const tool of SELECTABLE_TOOLS) {
      const result = await runCommand('tool.options', { tool });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });
});

describe('tool.select', () => {
  it('calls setActiveTool in the synchronous part and returns the tool', async () => {
    const spy = vi.fn(realSetActiveTool);
    useUIStore.setState({ setActiveTool: spy });
    const pending = runCommand('tool.select', { tool: 'brush' });
    expect(spy).toHaveBeenCalledWith('brush');
    expect(await pending).toEqual({ tool: 'brush' });
    expect(useUIStore.getState().activeTool).toBe('brush');
    expect(labels()).toEqual(['New Document']);
  });

  it('runs the tools\' activation hooks as the toolbox does', async () => {
    const deactivate = vi.spyOn(toolRegistry.text, 'onDeactivate');
    await runCommand('tool.select', { tool: 'text' });
    await runCommand('tool.select', { tool: 'brush' });
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown tool', async () => {
    expect((await failure(runCommand('tool.select', { tool: 'airbrush' }))).code).toBe('invalid');
  });
});

describe('tool.options and tool.describe', () => {
  it('reads the active tool by default', async () => {
    useUIStore.getState().setActiveTool('marquee-rect');
    expect(await runCommand('tool.options')).toEqual({
      tool: 'marquee-rect',
      options: { feather: 0, aspectRatioLocked: false, aspectRatioW: 1, aspectRatioH: 1 },
    });
  });

  it('reads gradient stops as hex', async () => {
    const result = (await runCommand('tool.options', { tool: 'gradient' })) as { options: Record<string, unknown> };
    expect(result.options.stops).toEqual([{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }]);
  });

  it('describes types, ranges for the document, and current values', async () => {
    const { tools } = (await runCommand('tool.describe', { tool: 'brush' })) as { tools: Record<string, Record<string, unknown>> };
    expect(Object.keys(tools)).toEqual(['brush']);
    expect(tools.brush!.size).toMatchObject({ type: 'number', min: 1, max: 600, value: 10 });
    expect(tools.brush!.hardness).toEqual({ type: 'number', min: 0, max: 100, value: 80 });
    const all = (await runCommand('tool.describe')) as { tools: Record<string, unknown> };
    expect(Object.keys(all.tools).sort()).toEqual([...SELECTABLE_TOOLS].sort());
    expect(getCommand('tool.set')?.params.options?.type).toBe('record');
  });
});

describe('tool.set', () => {
  it('calls the per-tool setters before awaiting, with no history, and returns the options', async () => {
    const pending = runCommand('tool.set', { tool: 'brush', options: { size: 40, hardness: 100 } });
    expect(settings().brush).toMatchObject({ size: 40, hardness: 100 });
    expect(await pending).toMatchObject({ tool: 'brush', options: { size: 40, hardness: 100, opacity: 100 } });
    expect(labels()).toEqual(['New Document']);
  });

  it('sets the brush size for Dodge, as its options bar does', async () => {
    await runCommand('tool.set', { tool: 'dodge', options: { size: 33, mode: 'burn' } });
    expect(settings().brush.size).toBe(33);
    expect(settings().dodge.mode).toBe('burn');
  });

  it('sets gradient type and stops as the Gradient Editor holds them', async () => {
    await runCommand('tool.set', {
      tool: 'gradient',
      options: { type: 'radial', stops: [{ position: 1, color: '#00f' }, { position: 0.25, color: '#ff000080' }] },
    });
    expect(settings().gradient.type).toBe('radial');
    expect(settings().gradient.stops).toEqual([
      { position: 0.25, color: { r: 255, g: 0, b: 0, a: 128 / 255 } },
      { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ]);
  });

  it('sets and removes shape colours, and the shared aspect ratio and symmetry', async () => {
    await runCommand('tool.set', { tool: 'shape', options: { fillColor: 'none', strokeColor: '#123456', aspectRatioW: 16 } });
    expect(settings().shape.fillColor).toBeNull();
    expect(settings().shape.strokeColor).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 });
    expect(useToolSettingsStore.getState().aspectRatioW).toBe(16);
    await runCommand('tool.set', { tool: 'brush', options: { symmetryRadialSegments: 6, symmetryVertical: true } });
    expect(useToolSettingsStore.getState()).toMatchObject({ symmetryRadialSegments: 6, symmetryVertical: true });
  });

  it('switches the crop mode through setCropMode, dropping a perspective quad', async () => {
    useUIStore.getState().setPerspectiveCropQuad({
      topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
    });
    await runCommand('tool.set', { tool: 'crop', options: { mode: 'perspective' } });
    expect(settings().crop.mode).toBe('perspective');
    expect(useUIStore.getState().perspectiveCropQuad).toBeNull();
  });

  it('sets text options when no text layer is active', async () => {
    await runCommand('tool.set', { tool: 'text', options: { fontSize: 48, align: 'center' } });
    expect(settings().text).toMatchObject({ fontSize: 48, align: 'center' });
  });

  it('refuses text options while a text layer is active', async () => {
    const doc = useEditorStore.getState().document;
    const layers = doc.layers.map((l) => (l.id === doc.activeLayerId ? ({ ...l, type: 'text' } as typeof l) : l));
    useEditorStore.setState({ document: { ...doc, layers } });
    const error = await failure(runCommand('tool.set', { tool: 'text', options: { fontSize: 48 } }));
    expect(error.code).toBe('refused');
    expect(error.message).toContain('is a text layer');
    expect(settings().text.fontSize).toBe(24);
  });

  it('is invalid for an unknown option, listing the tool\'s options', async () => {
    const error = await failure(runCommand('tool.set', { tool: 'marquee-rect', options: { size: 3 } }));
    expect(error.message).toBe(
      'tool.set: unknown option "size"; valid options for marquee-rect: feather, aspectRatioLocked, aspectRatioW, aspectRatioH',
    );
    expect((await failure(runCommand('tool.set', { tool: 'lasso', options: { feather: 1 } }))).message).toContain('lasso has no options');
  });

  it('is invalid for a wrong type, an out-of-range value or an empty set, and changes nothing', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ size: '40' }, 'tool.set: options.size must be a finite number, got "40"'],
      [{ size: 601 }, 'tool.set: options.size must be from 1 to 600 in this document, got 601'],
      [{ hardness: -1 }, 'tool.set: options.hardness must be from 0 to 100 in this document, got -1'],
      [{ symmetryVertical: 1 }, 'tool.set: options.symmetryVertical must be a boolean, got 1'],
    ];
    for (const [options, message] of cases) {
      const error = await failure(runCommand('tool.set', { tool: 'brush', options: { opacity: 50, ...options } }));
      expect([error.code, error.message]).toEqual(['invalid', message]);
    }
    expect((await failure(runCommand('tool.set', { tool: 'brush', options: {} }))).message).toBe(
      'tool.set: options is empty; valid options for brush: size, opacity, hardness, fade, symmetryHorizontal, symmetryVertical, symmetryRadialSegments',
    );
    expect(settings().brush.opacity).toBe(100);
    expect((await failure(runCommand('tool.set', { tool: 'dodge', options: { mode: 'lighten' } }))).message).toBe(
      'tool.set: options.mode must be one of "dodge", "burn", got "lighten"',
    );
    expect((await failure(runCommand('tool.set', { tool: 'gradient', options: { stops: [{ position: 0, color: '#000' }] } }))).code).toBe('invalid');
    expect((await failure(runCommand('tool.set', { tool: 'shape', options: { fillColor: 'red' } }))).code).toBe('invalid');
  });
});
