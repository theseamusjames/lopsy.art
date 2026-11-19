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
  applyGenericFilter: vi.fn(),
  applyInvert: vi.fn(),
  applyDesaturate: vi.fn(),
  applyFindEdges: vi.fn(),
  applyPatternFill: vi.fn(),
  applyColorLutDirect: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});

vi.mock('../../app/MenuBar/filter-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/MenuBar/filter-actions')>();
  return {
    ...actual,
    applyGenericFilter: mocks.applyGenericFilter,
    applyInvert: mocks.applyInvert,
    applyDesaturate: mocks.applyDesaturate,
    applyFindEdges: mocks.applyFindEdges,
  };
});

vi.mock('../../app/MenuBar/pattern-actions', () => ({ applyPatternFill: mocks.applyPatternFill }));
vi.mock('../../app/MenuBar/color-lut-actions', () => ({ applyColorLutDirect: mocks.applyColorLutDirect }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { usePatternStore } = await import('../../app/pattern-store');
const { filterRegistry } = await import('../../filters/filter-registry');
const { CommandError } = await import('../command');
const { runCommand, describeCommands } = await import('../registry');
await import('./filter');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";
const MASK = { data: Uint8ClampedArray.from([0, 0, 0, 0]), width: 2, height: 2, enabled: true };

function store() {
  return useEditorStore.getState();
}

function activeId(): string {
  const id = store().document.activeLayerId;
  if (!id) throw new Error('no active layer');
  return id;
}

function patchActive(patch: Record<string, unknown>): void {
  const doc = store().document;
  const layers = doc.layers.map((l) => (l.id === doc.activeLayerId ? ({ ...l, ...patch } as Layer) : l));
  useEditorStore.setState({ document: { ...doc, layers } });
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

function addPattern(id: string, name: string): void {
  usePatternStore.getState().addPattern({ id, name, width: 1, height: 1, data: new Uint8Array(4), thumbnail: '' });
}

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(40, 30, false);
  mocks.engine = {};
  useUIStore.getState().setMaskEditMode(false);
  usePatternStore.setState({ patterns: [], activePatternId: null });
  for (const fn of [mocks.applyGenericFilter, mocks.applyInvert, mocks.applyDesaturate, mocks.applyFindEdges, mocks.applyPatternFill, mocks.applyColorLutDirect]) {
    fn.mockClear();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the dialog filters', () => {
  it('defines one command per registry filter the menu opens as a dialog', () => {
    const ids = describeCommands().map((c) => c.id).filter((id) => id.startsWith('filter.'));
    const dialogIds = Object.keys(filterRegistry).filter((id) => id !== 'find-edges' && id !== 'tilt-shift-blur');
    expect(ids.sort()).toEqual(
      [...dialogIds.map((id) => `filter.${id}`), 'filter.color-lut', 'filter.desaturate', 'filter.find-edges', 'filter.invert', 'filter.pattern-fill'].sort(),
    );
    expect(ids).not.toContain('filter.tilt-shift-blur');
  });

  it('derives each param from the dialog definition, with its default', () => {
    const gaussian = describeCommands().find((c) => c.id === 'filter.gaussian-blur');
    expect(gaussian?.params.radius).toMatchObject({ type: 'number', min: 1, max: 400, default: 5 });
    const noise = describeCommands().find((c) => c.id === 'filter.add-noise');
    expect(noise?.params.monochromatic).toMatchObject({ type: 'string', enum: ['Color', 'Mono'], default: 'Color' });
    expect(noise?.summary).toContain('varies per call');
    const box = describeCommands().find((c) => c.id === 'filter.box-blur');
    expect(box?.params.radius).toMatchObject({ min: 1, max: 5000, default: 5 });
  });

  it('calls applyGenericFilter with the defaults in the synchronous part', async () => {
    const pending = runCommand('filter.gaussian-blur');
    expect(mocks.applyGenericFilter).toHaveBeenCalledWith('gaussian-blur', { radius: 5 });
    expect(await pending).toEqual({ layer: activeId(), target: 'pixels' });
  });

  it('maps a toggle label to its value', async () => {
    await runCommand('filter.add-noise', { amount: 40, monochromatic: 'Mono' });
    expect(mocks.applyGenericFilter).toHaveBeenCalledWith('add-noise', { amount: 40, monochromatic: 1, distribution: 0 });
  });

  it('rejects values outside the slider range', async () => {
    const error = await failure(runCommand('filter.gaussian-blur', { radius: 401 }));
    expect(error.code).toBe('invalid');
    expect((await failure(runCommand('filter.emboss', { type: 'Bump' }))).code).toBe('invalid');
    expect(mocks.applyGenericFilter).not.toHaveBeenCalled();
  });

  it('holds a document-scaled slider to the document\'s maximum', async () => {
    const error = await failure(runCommand('filter.box-blur', { radius: 101 }));
    expect([error.code, error.message]).toEqual([
      'invalid', "filter.box-blur: radius must be at most 100 on this 40x30 document, as the dialog's slider is, got 101",
    ]);
    mocks.engine = null;
    store().createDocument(400, 300, false);
    mocks.engine = {};
    await runCommand('filter.box-blur', { radius: 600 });
    expect(mocks.applyGenericFilter).toHaveBeenCalledWith('box-blur', { radius: 600 });
  });

  it('reports the mask target in mask edit mode, on any layer type', async () => {
    patchActive({ type: 'text', mask: MASK });
    useUIStore.getState().setMaskEditMode(true);
    expect(await runCommand('filter.posterize', { levels: 3 })).toEqual({ layer: activeId(), target: 'mask' });
  });

  it('refuses a text layer and a group with the text the menu toasts', async () => {
    patchActive({ type: 'text' });
    const text = await failure(runCommand('filter.threshold'));
    expect([text.code, text.notice, text.message]).toEqual(['refused', 'info', TEXT_REFUSAL]);
    useEditorStore.setState({ document: { ...store().document, activeLayerId: store().document.rootGroupId ?? null } });
    expect((await failure(runCommand('filter.threshold'))).message).toBe(GROUP_REFUSAL);
    expect(mocks.applyGenericFilter).not.toHaveBeenCalled();
  });

  it('is unavailable without an engine', async () => {
    mocks.engine = null;
    expect((await failure(runCommand('filter.threshold'))).code).toBe('unavailable');
  });
});

describe('the instant filters', () => {
  for (const [id, fn] of [
    ['filter.invert', mocks.applyInvert],
    ['filter.desaturate', mocks.applyDesaturate],
    ['filter.find-edges', mocks.applyFindEdges],
  ] as const) {
    it(`${id} calls the menu's function in the synchronous part`, async () => {
      const pending = runCommand(id);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(await pending).toEqual({ layer: activeId(), target: 'pixels' });
    });
  }

  it('refuses a text layer', async () => {
    patchActive({ type: 'text' });
    expect((await failure(runCommand('filter.invert'))).message).toBe(TEXT_REFUSAL);
    expect(mocks.applyInvert).not.toHaveBeenCalled();
  });

  it('takes no params', async () => {
    expect((await failure(runCommand('filter.invert', { amount: 1 }))).code).toBe('invalid');
  });
});

describe('filter.color-lut', () => {
  it('passes the built-in preset and the intensity as a fraction', async () => {
    const pending = runCommand('filter.color-lut', { preset: 'noir', intensity: 40 });
    expect(mocks.applyColorLutDirect).toHaveBeenCalledWith(expect.objectContaining({ id: 'noir' }), 0.4);
    expect(await pending).toEqual({ layer: activeId(), target: 'pixels' });
  });

  it('defaults to the dialog\'s first preset at full intensity', async () => {
    await runCommand('filter.color-lut');
    expect(mocks.applyColorLutDirect).toHaveBeenCalledWith(expect.objectContaining({ id: 'warm-vintage' }), 1);
  });

  it('refuses a group', async () => {
    useEditorStore.setState({ document: { ...store().document, activeLayerId: store().document.rootGroupId ?? null } });
    expect((await failure(runCommand('filter.color-lut'))).message).toBe(GROUP_REFUSAL);
  });
});

describe('filter.pattern-fill', () => {
  const DEFAULTS = { scale: 100, rowStagger: 0, columnStagger: 0, offsetX: 0, offsetY: 0 };

  it('is refused with the dialog\'s text when no pattern is defined', async () => {
    const error = await failure(runCommand('filter.pattern-fill'));
    expect([error.code, error.message]).toEqual([
      'refused', 'No patterns defined. Use Edit > Define Pattern to capture the active layer as a pattern.',
    ]);
  });

  it('fills with the active pattern and the dialog defaults', async () => {
    addPattern('p1', 'Pattern 1');
    const pending = runCommand('filter.pattern-fill');
    expect(mocks.applyPatternFill).toHaveBeenCalledWith('p1', DEFAULTS);
    expect(await pending).toEqual({ layer: activeId(), target: 'pixels' });
  });

  it('picks a pattern by name and makes it the current one, as its swatch does', async () => {
    addPattern('p1', 'Pattern 1');
    addPattern('p2', 'Pattern 2');
    await runCommand('filter.pattern-fill', { pattern: 'Pattern 1', scale: 50 });
    expect(mocks.applyPatternFill).toHaveBeenCalledWith('p1', { ...DEFAULTS, scale: 50 });
    expect(usePatternStore.getState().activePatternId).toBe('p1');
  });

  it('is not-found for an unknown pattern', async () => {
    addPattern('p1', 'Pattern 1');
    expect((await failure(runCommand('filter.pattern-fill', { pattern: 'nope' }))).code).toBe('not-found');
  });

  it('writes pixels even in mask edit mode, and refuses a text layer', async () => {
    addPattern('p1', 'Pattern 1');
    patchActive({ mask: MASK });
    useUIStore.getState().setMaskEditMode(true);
    expect(await runCommand('filter.pattern-fill')).toMatchObject({ target: 'pixels' });
    patchActive({ type: 'text' });
    expect((await failure(runCommand('filter.pattern-fill'))).message).toBe(TEXT_REFUSAL);
  });
});
