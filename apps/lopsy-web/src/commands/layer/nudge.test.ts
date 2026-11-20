// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const engine = { current: {} as unknown };
vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => engine.current };
});

const session = vi.hoisted(() => ({
  nudgeMove: vi.fn(),
  nudgeSelection: vi.fn(),
  clearPersistentTransform: vi.fn(),
}));
vi.mock('../../app/interactions/gesture-session', () => session);

const guards = vi.hoisted(() => ({ partialText: false, maskEdit: false }));
vi.mock('../../app/interactions/text-transform-handlers', () => ({
  isPartialTextMove: () => guards.partialText,
  PARTIAL_TEXT_MOVE_HINT: 'partial text hint',
}));
vi.mock('../../app/interactions/mask-edit-move-guard', () => ({
  isMaskEditSelectionMove: () => guards.maskEdit,
  MASK_EDIT_MOVE_HINT: 'mask edit hint',
}));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const coalesce = await import('../../app/shortcuts/nudge-coalesce');
const { MESH_WARP_NUDGE_REFUSAL } = await import('../../app/shortcuts/tool-shortcuts');
await import('./nudge');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

function activeId(): string {
  return useEditorStore.getState().document.activeLayerId ?? '';
}

const pushed: string[] = [];

function labels(): string[] {
  return pushed;
}

function patchActive(patch: Record<string, unknown>): void {
  const doc = useEditorStore.getState().document;
  const layers = doc.layers.map((l) => (l.id === doc.activeLayerId ? ({ ...l, ...patch } as Layer) : l));
  useEditorStore.setState({ document: { ...doc, layers } });
}

function selectBox(): void {
  const { width, height } = useEditorStore.getState().document;
  useEditorStore.getState().setSelection({ x: 0, y: 0, width: 4, height: 4 }, Uint8ClampedArray.from({ length: width * height }, () => 255), width, height);
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

beforeEach(() => {
  engine.current = null;
  useEditorStore.getState().createDocument(40, 30, false);
  engine.current = {};
  pushed.length = 0;
  useEditorStore.setState({ pushHistory: (label?: string) => { pushed.push(label ?? ''); } });
  useUIStore.getState().setActiveTool('brush');
  useUIStore.setState({ meshWarp: null });
  coalesce._resetNudgeCoalescer();
  guards.partialText = false;
  guards.maskEdit = false;
  session.nudgeMove.mockReset();
  session.nudgeSelection.mockReset();
});

describe('layer.nudge', () => {
  it('selects the Move tool and nudges once, with one Nudge entry, in the synchronous part', async () => {
    const pending = runCommand('layer.nudge', { dx: 3, dy: -2 });
    expect(useUIStore.getState().activeTool).toBe('move');
    expect(session.nudgeMove).toHaveBeenCalledTimes(1);
    expect(session.nudgeMove).toHaveBeenCalledWith(3, -2);
    expect(labels()).toEqual(['Nudge']);
    expect(coalesce.isNudgeHeld()).toBe(false);
    await expect(pending).resolves.toEqual({ layer: activeId(), x: 0, y: 0, selection: null });
  });

  it('reports the selection the float moved with', async () => {
    selectBox();
    await expect(runCommand('layer.nudge', { dy: 10 })).resolves.toMatchObject({ selection: { x: 0, y: 0, width: 4, height: 4 } });
    expect(session.nudgeMove).toHaveBeenCalledWith(0, 10);
  });

  it('refuses a zero offset, a locked layer, a held key, an open Mesh Warp and the hinted moves', async () => {
    expect(await failure(runCommand('layer.nudge', {}))).toMatchObject({ code: 'invalid', message: 'layer.nudge: dx and dy are both 0; nothing would move.' });
    patchActive({ locked: true });
    expect(await failure(runCommand('layer.nudge', { dx: 1 }))).toMatchObject({ code: 'refused', message: '"Layer 1" is locked: the arrow keys do not move it.' });
    patchActive({ locked: false });
    coalesce.scheduleNudge('ArrowLeft', false, -1, 0, () => {});
    expect((await failure(runCommand('layer.nudge', { dx: 1 }))).code).toBe('refused');
    coalesce._resetNudgeCoalescer();
    useUIStore.setState({ meshWarp: {} as never });
    expect(await failure(runCommand('layer.nudge', { dx: 1 }))).toMatchObject({ code: 'refused', message: MESH_WARP_NUDGE_REFUSAL, notice: null });
    useUIStore.setState({ meshWarp: null });
    guards.partialText = true;
    expect(await failure(runCommand('layer.nudge', { dx: 1 }))).toMatchObject({ code: 'refused', message: 'partial text hint', notice: 'info' });
    guards.partialText = false;
    guards.maskEdit = true;
    expect(await failure(runCommand('layer.nudge', { dx: 1 }))).toMatchObject({ code: 'refused', message: 'mask edit hint', notice: 'info' });
    expect(session.nudgeMove).not.toHaveBeenCalled();
    expect(labels()).toEqual(['Nudge']);
  });
});

describe('select.nudge', () => {
  it('keeps a selection tool, or selects the Rectangular Marquee, and nudges the outline once', async () => {
    selectBox();
    useUIStore.getState().setActiveTool('lasso');
    await runCommand('select.nudge', { dx: -1 });
    expect(useUIStore.getState().activeTool).toBe('lasso');
    expect(session.nudgeSelection).toHaveBeenCalledWith(-1, 0);
    useUIStore.getState().setActiveTool('move');
    const pending = runCommand('select.nudge', { dx: 2, dy: 2 });
    expect(useUIStore.getState().activeTool).toBe('marquee-rect');
    expect(session.nudgeSelection).toHaveBeenLastCalledWith(2, 2);
    await expect(pending).resolves.toEqual({ bounds: { x: 0, y: 0, width: 4, height: 4 } });
    expect(labels()).toEqual(['Nudge', 'Nudge']);
  });

  it('refuses with nothing selected, and a zero offset', async () => {
    expect(await failure(runCommand('select.nudge', { dx: 1 }))).toMatchObject({ code: 'refused', message: 'Nothing is selected: there is no outline to nudge.' });
    expect((await failure(runCommand('select.nudge', {}))).code).toBe('invalid');
    expect(session.nudgeSelection).not.toHaveBeenCalled();
  });
});
