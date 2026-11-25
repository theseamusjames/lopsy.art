// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeshWarpGrid } from '../../filters/mesh-warp';
import type { Rect } from '../../types';
import type { TiltShiftSession } from '../../app/ui-store';

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
  applyMeshWarp: vi.fn<(grid: MeshWarpGrid, bounds: Rect) => void>(),
  beginTiltShift: vi.fn<() => void>(),
  applyTiltShift: vi.fn<() => void>(),
  cancelTiltShift: vi.fn<() => void>(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});

vi.mock('../../app/MenuBar/mesh-warp-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/MenuBar/mesh-warp-actions')>();
  return { ...actual, applyMeshWarp: mocks.applyMeshWarp };
});

vi.mock('../../app/MenuBar/tilt-shift-actions', () => ({
  beginTiltShiftSession: mocks.beginTiltShift,
  applyTiltShift: mocks.applyTiltShift,
  cancelTiltShift: mocks.cancelTiltShift,
}));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./session-filters');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";
const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const OPEN_SESSION = (name: string) => `A ${name} session is open, and it would take the press instead of the tool: apply or cancel it first.`;

function store() {
  return useEditorStore.getState();
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

const SESSION_START: TiltShiftSession = {
  focusPosition: 0.5, focusWidth: 0.4, blurRadius: 12, angle: 0, dragging: null, dragAnchor: 0, previewActive: true,
};

let appliedSession: TiltShiftSession | null = null;

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(200, 100, false);
  mocks.engine = {};
  useUIStore.setState({ liquify: null, tiltShift: null, meshWarp: null });
  useUIStore.getState().setMaskEditMode(false);
  appliedSession = null;
  mocks.applyMeshWarp.mockReset();
  mocks.beginTiltShift.mockReset().mockImplementation(() => useUIStore.getState().setTiltShift({ ...SESSION_START }));
  mocks.applyTiltShift.mockReset().mockImplementation(() => {
    appliedSession = useUIStore.getState().tiltShift;
    useUIStore.getState().setTiltShift(null);
  });
  mocks.cancelTiltShift.mockReset().mockImplementation(() => useUIStore.getState().setTiltShift(null));
});

describe('filter.mesh-warp', () => {
  it('applies the controls\' 4 x 4 identity grid over the document when no point is given', async () => {
    const result = await runCommand('filter.mesh-warp', {});
    expect(result).toEqual({ layer: store().document.activeLayerId, target: 'pixels', bounds: { x: 0, y: 0, width: 200, height: 100 } });
    const [grid, bounds] = mocks.applyMeshWarp.mock.calls[0]!;
    expect([grid.cols, grid.rows]).toEqual([4, 4]);
    expect(grid.points[5]).toEqual({ x: 1 / 3, y: 1 / 3 });
    expect(bounds).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(useUIStore.getState().meshWarp).toBeNull();
  });

  it('moves each listed point by its offset in document pixels, in the bounds\' units, held inside them as a drag is', async () => {
    await runCommand('filter.mesh-warp', {
      gridSize: 3,
      points: [{ col: 1, row: 1, dx: 20, dy: -10 }, { col: 2, row: 0, dx: 50, dy: -50 }],
    });
    const [grid] = mocks.applyMeshWarp.mock.calls[0]!;
    expect([grid.cols, grid.rows]).toEqual([3, 3]);
    expect(grid.points[4]!.x).toBeCloseTo(0.6, 12);
    expect(grid.points[4]!.y).toBeCloseTo(0.4, 12);
    expect(grid.points[2]).toEqual({ x: 1, y: 0 });
    expect(grid.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('covers the selection\'s bounding box, clamped to the document, as the controls do', async () => {
    store().setSelection({ x: -10, y: 20, width: 110, height: 40 }, Uint8ClampedArray.of(255), 1, 1);
    await runCommand('filter.mesh-warp', { points: [{ col: 0, row: 0, dx: 10, dy: 0 }] });
    const [grid, bounds] = mocks.applyMeshWarp.mock.calls[0]!;
    expect(bounds).toEqual({ x: 0, y: 20, width: 100, height: 40 });
    expect(grid.points[0]!.x).toBeCloseTo(0.1, 12);
  });

  it('rejects points off the grid or listed twice, and a grid size the select does not offer', async () => {
    expect((await failure(runCommand('filter.mesh-warp', { gridSize: 3, points: [{ col: 3, row: 0, dx: 1, dy: 1 }] }))).message)
      .toBe('filter.mesh-warp: the point (col 3, row 0) is outside a 3 x 3 grid.');
    const twice = [{ col: 1, row: 1, dx: 1, dy: 1 }, { col: 1, row: 1, dx: 2, dy: 2 }];
    expect((await failure(runCommand('filter.mesh-warp', { points: twice }))).code).toBe('invalid');
    expect((await failure(runCommand('filter.mesh-warp', { gridSize: 7 }))).code).toBe('invalid');
    expect(mocks.applyMeshWarp).not.toHaveBeenCalled();
  });

  it('refuses a group or text layer with the controls\' toast, and an open session', async () => {
    patchActive({ type: 'group' });
    expect(await failure(runCommand('filter.mesh-warp', {}))).toMatchObject({ code: 'refused', notice: 'info', message: GROUP_REFUSAL });
    patchActive({ type: 'text' });
    expect(await failure(runCommand('filter.mesh-warp', {}))).toMatchObject({ code: 'refused', message: TEXT_REFUSAL });
    patchActive({ type: 'raster' });
    useUIStore.setState({ liquify: {} as never });
    expect(await failure(runCommand('filter.mesh-warp', {}))).toMatchObject({ code: 'refused', message: OPEN_SESSION('Liquify') });
    expect(mocks.applyMeshWarp).not.toHaveBeenCalled();
  });

  it('is unavailable without an engine', async () => {
    mocks.engine = null;
    expect((await failure(runCommand('filter.mesh-warp', {}))).code).toBe('unavailable');
  });
});

describe('filter.tilt-shift', () => {
  it('starts the session, sets its values through the store and applies it, leaving no session', async () => {
    const result = await runCommand('filter.tilt-shift', { focusPosition: 0.2, focusWidth: 0.1, blurRadius: 20, angle: 45 });
    expect(result).toEqual({ layer: store().document.activeLayerId, target: 'pixels' });
    expect(mocks.beginTiltShift).toHaveBeenCalledTimes(1);
    expect(appliedSession).toMatchObject({ focusPosition: 0.2, focusWidth: 0.1, blurRadius: 20, angle: 45 });
    expect(mocks.cancelTiltShift).not.toHaveBeenCalled();
    expect(useUIStore.getState().tiltShift).toBeNull();
  });

  it('defaults to the values the session starts with', async () => {
    await runCommand('filter.tilt-shift', {});
    expect(appliedSession).toMatchObject({ focusPosition: 0.5, focusWidth: 0.4, blurRadius: 12, angle: 0 });
  });

  it('cancels the session when applying it fails part-way', async () => {
    mocks.applyTiltShift.mockImplementation(() => {
      throw new Error('lost');
    });
    await expect(runCommand('filter.tilt-shift', {})).rejects.toThrow('lost');
    expect(mocks.cancelTiltShift).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().tiltShift).toBeNull();
  });

  it('refuses mask edit mode, a group or text layer, an open session, and a session that did not start', async () => {
    patchActive({ mask: { data: Uint8ClampedArray.from([0, 0, 0, 0]), width: 2, height: 2, enabled: true } });
    useUIStore.getState().setMaskEditMode(true);
    expect((await failure(runCommand('filter.tilt-shift', {}))).message).toMatch(/disabled in layer-mask edit mode/);
    useUIStore.getState().setMaskEditMode(false);
    patchActive({ type: 'group', mask: null });
    expect(await failure(runCommand('filter.tilt-shift', {}))).toMatchObject({ code: 'refused', notice: 'info', message: GROUP_REFUSAL });
    patchActive({ type: 'raster' });
    useUIStore.setState({ meshWarp: {} as never });
    expect(await failure(runCommand('filter.tilt-shift', {}))).toMatchObject({ message: OPEN_SESSION('Mesh Warp') });
    useUIStore.setState({ meshWarp: null });
    expect(mocks.beginTiltShift).not.toHaveBeenCalled();
    mocks.beginTiltShift.mockImplementation(() => undefined);
    expect(await failure(runCommand('filter.tilt-shift', {}))).toMatchObject({ message: 'The Tilt-Shift session did not start.' });
    expect(mocks.applyTiltShift).not.toHaveBeenCalled();
  });

  it('rejects values outside the session\'s ranges', async () => {
    for (const params of [{ focusPosition: 1.1 }, { focusWidth: -0.1 }, { blurRadius: 0 }, { blurRadius: 33 }, { blurRadius: 2.5 }, { angle: 361 }]) {
      expect((await failure(runCommand('filter.tilt-shift', params))).code).toBe('invalid');
    }
  });
});
