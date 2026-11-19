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
  rasterizePathToLayer: vi.fn((..._args: unknown[]) => true),
  booleanOp: vi.fn(),
}));

vi.mock('../../tools/path/boolean-ops', () => ({ booleanOp: mocks.booleanOp }));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../app/interactions/path-stroke', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/interactions/path-stroke')>();
  return { ...actual, rasterizePathToLayer: mocks.rasterizePathToLayer };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./path');

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

const SQUARE = (x: number, y: number, size: number) => [
  { point: { x, y } },
  { point: { x: x + size, y } },
  { point: { x: x + size, y: y + size } },
  { point: { x, y: y + size } },
];

function lastLabel(): string | undefined {
  return store().undoStack[store().undoStack.length - 1]?.label;
}

function labels(): string[] {
  return store().undoStack.map((e) => e.label);
}

async function addSquare(x: number, y: number, size: number): Promise<{ id: string; name: string }> {
  return (await runCommand('path.add', { anchors: SQUARE(x, y, size), closed: true })) as { id: string; name: string };
}

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(200, 150, false);
  useEditorStore.setState({ paths: [], selectedPathId: null });
  mocks.engine = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('path.add', () => {
  it('stores the anchors in document space as "Add Path", names and selects the path, in the synchronous part', async () => {
    const pending = runCommand('path.add', { anchors: [{ point: { x: 1, y: 2 }, handleOut: { x: 5, y: 2 } }, { point: { x: 9, y: 9 } }] });
    expect(store().paths).toHaveLength(1);
    const result = (await pending) as { id: string; name: string };
    const [path] = store().paths;
    expect(result).toEqual({ id: path!.id, name: 'Path 1' });
    expect(store().selectedPathId).toBe(path!.id);
    expect(path!.closed).toBe(false);
    expect(path!.anchors).toEqual([
      { point: { x: 1, y: 2 }, handleIn: null, handleOut: { x: 5, y: 2 } },
      { point: { x: 9, y: 9 }, handleIn: null, handleOut: null },
    ]);
    expect(lastLabel()).toBe('Add Path');
  });

  it('needs at least two anchors, as the Pen tool does', async () => {
    expect((await failure(runCommand('path.add', { anchors: [{ point: { x: 1, y: 1 } }] }))).code).toBe('invalid');
    expect(store().paths).toHaveLength(0);
  });
});

describe('path.list, path.select, path.rename and path.remove', () => {
  it('lists the paths with their anchors and the selected one', async () => {
    const a = await addSquare(10, 10, 20);
    const result = await runCommand('path.list');
    expect(result).toEqual({
      paths: [{ id: a.id, name: 'Path 1', closed: true, anchors: SQUARE(10, 10, 20).map((p) => ({ ...p, handleIn: null, handleOut: null })) }],
      selected: a.id,
    });
  });

  it('selects by name and deselects when path is omitted, with no history', async () => {
    const a = await addSquare(10, 10, 20);
    await addSquare(40, 40, 20);
    const before = labels();
    expect(await runCommand('path.select', { path: 'Path 1' })).toEqual(a);
    expect(store().selectedPathId).toBe(a.id);
    expect(await runCommand('path.select', {})).toBeNull();
    expect(store().selectedPathId).toBeNull();
    expect(labels()).toEqual(before);
  });

  it('renames with "Rename Path" and refuses the same name', async () => {
    const a = await addSquare(10, 10, 20);
    expect(await runCommand('path.rename', { path: a.id, name: 'Outline' })).toEqual({ id: a.id, name: 'Outline' });
    expect(store().paths[0]!.name).toBe('Outline');
    expect(lastLabel()).toBe('Rename Path');
    expect(await failure(runCommand('path.rename', { path: 'Outline', name: 'Outline' }))).toMatchObject({
      code: 'refused', message: 'The path is already named "Outline".',
    });
  });

  it('removes with "Delete Path"', async () => {
    const a = await addSquare(10, 10, 20);
    expect(await runCommand('path.remove', { path: 'Path 1' })).toEqual(a);
    expect(store().paths).toHaveLength(0);
    expect(lastLabel()).toBe('Delete Path');
  });

  it('reports an unknown path as not-found and an ambiguous name as invalid with the ids', async () => {
    const a = await addSquare(10, 10, 20);
    const b = await addSquare(40, 40, 20);
    expect((await failure(runCommand('path.remove', { path: 'nope' }))).code).toBe('not-found');
    store().renamePath(b.id, 'Path 1');
    const error = await failure(runCommand('path.select', { path: 'Path 1' }));
    expect(error.code).toBe('invalid');
    expect(error.message).toBe(`2 paths are named "Path 1": pass one of their ids: ${a.id}, ${b.id}`);
  });
});

describe('path.stroke', () => {
  it('strokes the selected path onto the active layer with the dialog\'s default width and the foreground colour', async () => {
    const a = await addSquare(10, 10, 20);
    useToolSettingsStore.getState().setPathSetting('strokeWidth', 7);
    const layer = store().document.activeLayerId;
    const pending = runCommand('path.stroke');
    expect(mocks.rasterizePathToLayer).toHaveBeenCalledWith(
      store().paths[0]!.anchors, true, layer, 7, useToolSettingsStore.getState().foregroundColor,
    );
    expect(await pending).toEqual({ path: a.id, layer, width: 7 });
  });

  it('rounds the width as the dialog does', async () => {
    await addSquare(10, 10, 20);
    expect(await runCommand('path.stroke', { path: 'Path 1', width: 2.6 })).toMatchObject({ width: 3 });
    expect(mocks.rasterizePathToLayer.mock.calls[0]![3]).toBe(3);
    expect((await failure(runCommand('path.stroke', { width: 51 }))).code).toBe('invalid');
    expect((await failure(runCommand('path.stroke', { width: 0.5 }))).code).toBe('invalid');
  });

  it('refuses with no selected path, and on a group with the dialog\'s toast', async () => {
    expect(await failure(runCommand('path.stroke'))).toMatchObject({
      code: 'refused', message: 'No path is selected: pass path, or select one with path.select.',
    });
    await addSquare(10, 10, 20);
    useEditorStore.setState({ document: { ...store().document, activeLayerId: store().document.rootGroupId ?? null } });
    const error = await failure(runCommand('path.stroke'));
    expect([error.code, error.notice, error.message]).toEqual(['refused', 'info', "Groups can't be painted on. Select a layer inside the group."]);
    expect(mocks.rasterizePathToLayer).not.toHaveBeenCalled();
  });

  it('is unavailable without an engine', async () => {
    await addSquare(10, 10, 20);
    mocks.engine = null;
    expect((await failure(runCommand('path.stroke'))).code).toBe('unavailable');
    expect(mocks.rasterizePathToLayer).not.toHaveBeenCalled();
  });
});

const ISLAND = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }].map((point) => ({ point, handleIn: null, handleOut: null }));

/** jsdom has no 2D canvas to rasterize the paths with, so the operation's result is given. */
function booleanResult(islands: number): void {
  mocks.booleanOp.mockReturnValue({ hasArea: islands > 0, paths: Array.from({ length: islands }, () => ISLAND) });
}

describe('the boolean path commands', () => {
  it('path.unite replaces the selected path and the newest other one with their union', async () => {
    booleanResult(1);
    await addSquare(20, 20, 80);
    await addSquare(60, 40, 80);
    const result = (await runCommand('path.unite')) as { paths: Array<{ id: string; name: string }> };
    expect(result.paths).toHaveLength(1);
    expect(store().paths.map((p) => p.id)).toEqual([result.paths[0]!.id]);
    expect(store().selectedPathId).toBe(result.paths[0]!.id);
    expect(lastLabel()).toBe('Unite Paths');
    expect(mocks.booleanOp.mock.calls[0]![2]).toBe('union');
  });

  it('path.exclude returns one path per island', async () => {
    booleanResult(2);
    await addSquare(20, 20, 80);
    await addSquare(60, 40, 80);
    expect(((await runCommand('path.exclude')) as { paths: unknown[] }).paths).toHaveLength(2);
    expect(lastLabel()).toBe('Exclude Paths');
  });

  it('refuses with fewer than two paths and with none selected, where the menu does nothing', async () => {
    expect((await failure(runCommand('path.subtract'))).message).toBe('A boolean path operation needs two paths; the document has 0.');
    await addSquare(20, 20, 80);
    await addSquare(60, 40, 80);
    store().selectPath(null);
    const before = labels();
    expect((await failure(runCommand('path.intersect'))).message).toBe(
      'No path is selected: a boolean path operation combines the selected path with the most recently added other one.',
    );
    expect(labels()).toEqual(before);
  });

  it('refuses a result with no area', async () => {
    booleanResult(0);
    await addSquare(10, 10, 20);
    await addSquare(120, 80, 20);
    const before = store().paths;
    expect(await failure(runCommand('path.intersect'))).toMatchObject({
      code: 'refused', message: 'Intersect Paths: the result has no area, so the paths are unchanged.',
    });
    expect(store().paths).toBe(before);
  });
});
