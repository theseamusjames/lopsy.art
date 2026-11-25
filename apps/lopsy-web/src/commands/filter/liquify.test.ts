// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GestureInput } from '../gesture/run-gesture';
import type { LiquifySettings } from '../../tools/liquify/liquify';

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
  open: vi.fn<() => void>(),
  apply: vi.fn<() => void>(),
  cancel: vi.fn<() => void>(),
  gesture: vi.fn<(input: GestureInput) => { tool: string; layer: string }>(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});

vi.mock('../../app/MenuBar/liquify-actions', () => ({
  openLiquify: mocks.open,
  applyLiquify: mocks.apply,
  cancelLiquify: mocks.cancel,
}));

vi.mock('../gesture/run-gesture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gesture/run-gesture')>();
  return { ...actual, runGesture: mocks.gesture };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./liquify');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";
const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const STROKE = { points: [{ x: 10, y: 10 }, { x: 14, y: 10 }, { x: 18, y: 10 }] };

function store() {
  return useEditorStore.getState();
}

function ui() {
  return useUIStore.getState();
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

/** The session's settings at each stroke's drag, and what order the session's steps ran in. */
let strokeSettings: LiquifySettings[] = [];
let order: string[] = [];

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(200, 100, false);
  mocks.engine = {};
  useUIStore.setState({ liquify: null, tiltShift: null, meshWarp: null });
  ui().setMaskEditMode(false);
  ui().setActiveTool('brush');
  strokeSettings = [];
  order = [];
  mocks.open.mockReset().mockImplementation(() => {
    order.push('open');
    ui().setLiquify({ layerId: store().document.activeLayerId ?? '', layerWidth: 200, layerHeight: 100, settings: { mode: 'push', brushSize: 64, pressure: 0.5 } });
  });
  mocks.apply.mockReset().mockImplementation(() => {
    order.push('apply');
    ui().setLiquify(null);
  });
  mocks.cancel.mockReset().mockImplementation(() => {
    order.push('cancel');
    ui().setLiquify(null);
  });
  mocks.gesture.mockReset().mockImplementation(() => {
    order.push('stroke');
    strokeSettings.push(ui().liquify!.settings);
    return { tool: 'brush', layer: store().document.activeLayerId ?? '' };
  });
});

describe('filter.liquify', () => {
  it('opens the session, drags each stroke for it with the panel\'s defaults, and applies', async () => {
    const result = await runCommand('filter.liquify', { strokes: [STROKE] });
    expect(result).toEqual({ layer: store().document.activeLayerId, target: 'pixels', strokes: 1, dabs: 2 });
    expect(order).toEqual(['open', 'stroke', 'apply']);
    expect(mocks.gesture).toHaveBeenCalledWith({ points: STROKE.points, session: 'liquify' });
    expect(strokeSettings).toEqual([{ mode: 'push', brushSize: 64, pressure: 0.5 }]);
    expect(ui().liquify).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(ui().activeTool).toBe('brush');
  });

  it('sets the panel\'s Mode, Brush Size and Pressure before each stroke\'s drag, pressure as the slider\'s percent', async () => {
    const result = await runCommand('filter.liquify', {
      strokes: [
        { ...STROKE, mode: 'twirl-ccw', size: 120, pressure: 80 },
        { points: [{ x: 50, y: 50 }, { x: 50, y: 50 }], mode: 'pinch', size: 4, pressure: 1 },
      ],
    });
    expect(result).toMatchObject({ strokes: 2, dabs: 3 });
    expect(strokeSettings).toEqual([
      { mode: 'twirl-ccw', brushSize: 120, pressure: 0.8 },
      { mode: 'pinch', brushSize: 4, pressure: 0.01 },
    ]);
    expect(order).toEqual(['open', 'stroke', 'stroke', 'apply']);
  });

  it('cancels the session when a stroke throws, and passes the error on', async () => {
    mocks.gesture.mockImplementationOnce(() => ({ tool: 'brush', layer: 'a' })).mockImplementationOnce(() => {
      throw new CommandError('refused', 'the press was dropped');
    });
    expect(await failure(runCommand('filter.liquify', { strokes: [STROKE, STROKE, STROKE] }))).toMatchObject({ code: 'refused', message: 'the press was dropped' });
    expect(mocks.gesture).toHaveBeenCalledTimes(2);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(ui().liquify).toBeNull();
  });

  it('cancels the session when Apply leaves it open or throws', async () => {
    mocks.apply.mockImplementation(() => {});
    await runCommand('filter.liquify', { strokes: [STROKE] });
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(ui().liquify).toBeNull();
    const bug = new Error('apply failed');
    mocks.apply.mockImplementation(() => {
      throw bug;
    });
    await expect(runCommand('filter.liquify', { strokes: [STROKE] })).rejects.toBe(bug);
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(ui().liquify).toBeNull();
  });

  it('refuses when the session does not start', async () => {
    mocks.open.mockImplementation(() => {});
    expect(await failure(runCommand('filter.liquify', { strokes: [STROKE] }))).toMatchObject({ code: 'refused', message: 'The Liquify session did not start.' });
    expect(mocks.gesture).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('refuses a group or text layer with the menu\'s toast, a locked layer and layer-mask edit mode, before opening', async () => {
    patchActive({ type: 'group', children: [] });
    expect(await failure(runCommand('filter.liquify', { strokes: [STROKE] }))).toMatchObject({ code: 'refused', message: GROUP_REFUSAL, notice: 'info' });
    patchActive({ type: 'text', text: 'Hi' });
    expect(await failure(runCommand('filter.liquify', { strokes: [STROKE] }))).toMatchObject({ code: 'refused', message: TEXT_REFUSAL, notice: 'info' });
    patchActive({ type: 'raster', locked: true });
    expect((await failure(runCommand('filter.liquify', { strokes: [STROKE] }))).message).toContain('is locked: unlock it to liquify it');
    patchActive({ locked: false, mask: { data: Uint8ClampedArray.from([0, 0, 0, 0]), width: 2, height: 2, enabled: true } });
    ui().setMaskEditMode(true);
    expect((await failure(runCommand('filter.liquify', { strokes: [STROKE] }))).message).toContain('disabled in layer-mask edit mode');
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it.each([
    ['liquify', 'Liquify'],
    ['tiltShift', 'Tilt-Shift'],
    ['meshWarp', 'Mesh Warp'],
  ])('refuses while a %s session is open, and leaves that session alone', async (field, name) => {
    useUIStore.setState({ [field]: {} } as unknown as Partial<ReturnType<typeof useUIStore.getState>>);
    expect((await failure(runCommand('filter.liquify', { strokes: [STROKE] }))).message)
      .toBe(`A ${name} session is open, and it would take the press instead of the tool: apply or cancel it first.`);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect((ui() as unknown as Record<string, unknown>)[field]).not.toBeNull();
  });

  it('rejects strokes the panel and a drag could not make, and more dabs than one call applies', async () => {
    const invalid = async (strokes: unknown): Promise<string> => {
      const error = await failure(runCommand('filter.liquify', { strokes }));
      expect(error.code).toBe('invalid');
      return error.message;
    };
    await invalid([]);
    await invalid([{ points: [{ x: 1, y: 1 }] }]);
    await invalid([{ ...STROKE, mode: 'smear' }]);
    await invalid([{ ...STROKE, size: 3 }]);
    await invalid([{ ...STROKE, size: 64.5 }]);
    await invalid([{ ...STROKE, pressure: 101 }]);
    const many = Array.from({ length: 5002 }, () => ({ x: 1, y: 1 }));
    expect(await invalid([{ points: many }, { points: many }])).toContain('the strokes make 10002 dabs between them');
    expect((await failure(runCommand('filter.liquify', {}))).code).toBe('invalid');
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
