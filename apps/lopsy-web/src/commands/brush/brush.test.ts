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

const mocks = vi.hoisted(() => ({
  engine: null as object | null,
  readSelectionBrushTip: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../app/MenuBar/brush-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/MenuBar/brush-actions')>();
  return { ...actual, readSelectionBrushTip: mocks.readSelectionBrushTip };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./brush');

function store() {
  return useEditorStore.getState();
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

const TIP = { width: 12, height: 8, data: new Uint8Array(96) };

function select(): void {
  useEditorStore.setState({
    selection: { active: true, bounds: { x: 0, y: 0, width: 12, height: 8 }, mask: Uint8ClampedArray.from({ length: 1200 }, () => 255), maskWidth: 40, maskHeight: 30 },
  });
}

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(40, 30, false);
  mocks.engine = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('brush.define', () => {
  it('reads the tip in the synchronous part, then adds the named preset and makes it active', async () => {
    select();
    mocks.readSelectionBrushTip.mockResolvedValue(TIP);
    const pending = runCommand('brush.define', { name: 'Stamp' });
    expect(mocks.readSelectionBrushTip).toHaveBeenCalledWith(false);
    const result = (await pending) as { id: string; name: string };
    const tools = useToolSettingsStore.getState();
    const preset = tools.presets.find((p) => p.id === result.id);
    expect(result.name).toBe('Stamp');
    expect(preset).toMatchObject({ name: 'Stamp', size: 12, isCustom: true, tip: TIP });
    expect(tools.activePresetId).toBe(result.id);
  });

  it('reads a colour tip with color true, as Define Color Brush... does', async () => {
    select();
    mocks.readSelectionBrushTip.mockResolvedValue(TIP);
    await runCommand('brush.define', { name: 'Paint', color: true });
    expect(mocks.readSelectionBrushTip).toHaveBeenCalledWith(true);
  });

  it('refuses without a selection, where the menu items are disabled', async () => {
    expect(await failure(runCommand('brush.define', { name: 'x' }))).toMatchObject({
      code: 'refused', message: 'Nothing is selected: Define Brush needs a selection around the brush tip.',
    });
    expect(mocks.readSelectionBrushTip).not.toHaveBeenCalled();
  });

  it('refuses an empty tip silently with the text readSelectionBrushTip has already toasted, adding no preset', async () => {
    select();
    mocks.readSelectionBrushTip.mockResolvedValue(null);
    const count = useToolSettingsStore.getState().presets.length;
    const error = await failure(runCommand('brush.define', { name: 'x', color: true }));
    expect([error.code, error.notice, error.message]).toEqual(['refused', null, 'The selection has no visible pixels, so the brush would be empty.']);
    expect(useToolSettingsStore.getState().presets.length).toBe(count);
  });

  it('needs a name and an engine', async () => {
    select();
    expect((await failure(runCommand('brush.define', {}))).code).toBe('invalid');
    expect((await failure(runCommand('brush.define', { name: '' }))).code).toBe('invalid');
    mocks.engine = null;
    expect((await failure(runCommand('brush.define', { name: 'x' }))).code).toBe('unavailable');
    expect(mocks.readSelectionBrushTip).not.toHaveBeenCalled();
  });
});
