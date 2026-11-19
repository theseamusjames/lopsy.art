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
  pasteInternalClipboard: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../app/paste-or-open', () => ({ pasteInternalClipboard: mocks.pasteInternalClipboard }));

const { useEditorStore } = await import('../../app/editor-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./clipboard');

const CLIP = { width: 40, height: 30, offsetX: 10, offsetY: 5, gpuResident: true as const };

function store() {
  return useEditorStore.getState();
}

function setsClipboard() {
  return vi.fn(() => {
    useEditorStore.setState({ clipboard: { ...CLIP } });
  });
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

function stub(action: 'copy' | 'cut', fn: () => void): void {
  useEditorStore.setState(action === 'copy' ? { copy: fn } : { cut: fn });
}

function activateRoot(): void {
  const rootId = store().document.rootGroupId;
  if (!rootId) throw new Error('no root group');
  useEditorStore.setState({ document: { ...store().document, activeLayerId: rootId } });
}

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(40, 30, false);
  useEditorStore.setState({ clipboard: null });
  mocks.engine = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each([
  ['clipboard.copy', 'copy', 'copied'],
  ['clipboard.cut', 'cut', 'cut'],
] as const)('%s', (id, action, verb) => {
  it(`calls the store's ${action}() in the synchronous part and returns the clipboard size`, async () => {
    const fn = setsClipboard();
    stub(action, fn);
    const pending = runCommand(id);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ width: 40, height: 30 });
  });

  it('refuses a group with the text the menu toasts', async () => {
    const fn = setsClipboard();
    stub(action, fn);
    activateRoot();
    const error = await failure(runCommand(id));
    expect([error.code, error.notice, error.message]).toEqual([
      'refused', 'info', `Groups can't be ${verb} from. Select a layer inside the group, or use Copy Merged.`,
    ]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses with no active layer, and is unavailable without an engine', async () => {
    const fn = setsClipboard();
    stub(action, fn);
    useEditorStore.setState({ document: { ...store().document, activeLayerId: null } });
    expect(await failure(runCommand(id))).toMatchObject({ code: 'refused', message: `There is no active layer to be ${verb} from.` });
    mocks.engine = null;
    store().createDocument(40, 30, false);
    expect((await failure(runCommand(id))).code).toBe('unavailable');
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses when the engine copied nothing', async () => {
    stub(action, vi.fn());
    expect((await failure(runCommand(id))).message).toBe('The engine copied nothing, so the clipboard is unchanged.');
  });
});

describe('clipboard.copy-merged', () => {
  it('starts copyMerged in the synchronous part and resolves with the clipboard once it settles', async () => {
    let finish: () => void = () => undefined;
    const copyMerged = vi.fn(() => new Promise<void>((resolve) => {
      finish = () => {
        useEditorStore.setState({ clipboard: { ...CLIP } });
        resolve();
      };
    }));
    useEditorStore.setState({ copyMerged });
    const pending = runCommand('clipboard.copy-merged');
    expect(copyMerged).toHaveBeenCalledTimes(1);
    finish();
    expect(await pending).toEqual({ width: 40, height: 30 });
  });

  it('works with a group active, which Copy and Cut refuse', async () => {
    useEditorStore.setState({ copyMerged: vi.fn(() => {
      useEditorStore.setState({ clipboard: { ...CLIP } });
      return Promise.resolve();
    }) });
    activateRoot();
    expect(await runCommand('clipboard.copy-merged')).toEqual({ width: 40, height: 30 });
  });

  it('is unavailable without an engine', async () => {
    mocks.engine = null;
    expect((await failure(runCommand('clipboard.copy-merged'))).code).toBe('unavailable');
  });
});

describe('clipboard.paste', () => {
  it('calls pasteInternalClipboard in the synchronous part and resolves with the id once the pixels are selected', async () => {
    useEditorStore.setState({ clipboard: { ...CLIP } });
    let select: () => void = () => undefined;
    mocks.pasteInternalClipboard.mockReturnValue({ id: 'pasted', selected: new Promise<void>((resolve) => { select = resolve; }) });
    let isDone = false;
    const pending = runCommand('clipboard.paste').then((result) => {
      isDone = true;
      return result;
    });
    expect(mocks.pasteInternalClipboard).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isDone).toBe(false);
    select();
    expect(await pending).toEqual({ id: 'pasted' });
  });

  it('refuses an empty clipboard without pasting, where the menu does nothing', async () => {
    const error = await failure(runCommand('clipboard.paste'));
    expect([error.code, error.notice, error.message]).toEqual(['refused', null, 'The clipboard is empty: copy or cut something first.']);
    expect(mocks.pasteInternalClipboard).not.toHaveBeenCalled();
  });

  it('needs a document and an engine', async () => {
    useEditorStore.setState({ clipboard: { ...CLIP } });
    mocks.engine = null;
    expect((await failure(runCommand('clipboard.paste'))).code).toBe('unavailable');
    expect(mocks.pasteInternalClipboard).not.toHaveBeenCalled();
  });
});
