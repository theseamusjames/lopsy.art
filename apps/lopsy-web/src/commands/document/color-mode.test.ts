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

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../../app/editor-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./color-mode');

type Store = ReturnType<typeof useEditorStore.getState>;

const realConvert = useEditorStore.getState().convertColorMode;

function store(): Store {
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

beforeEach(() => {
  useEditorStore.setState({ convertColorMode: realConvert });
  store().createDocument(20, 10, false);
});

describe('doc.color-mode', () => {
  it('calls convertColorMode in the synchronous part and resolves once it has converted', async () => {
    const convert = vi.fn(realConvert);
    useEditorStore.setState({ convertColorMode: convert });
    const pending = runCommand('doc.color-mode', { mode: 'grayscale' });
    expect(convert).toHaveBeenCalledWith('grayscale', undefined);
    expect(await pending).toEqual({ colorMode: 'grayscale' });
    expect(store().undoStack[store().undoStack.length - 1]?.label).toBe('Convert to Grayscale');
  });

  it('passes the Indexed Color dialog\'s options, with its defaults', async () => {
    const convert = vi.fn(() => Promise.resolve(false));
    useEditorStore.setState({ convertColorMode: convert });
    await runCommand('doc.color-mode', { mode: 'indexed', maxColors: 4, dither: true }).catch(() => undefined);
    expect(convert).toHaveBeenLastCalledWith('indexed', { maxColors: 4, dither: true });
    await runCommand('doc.color-mode', { mode: 'indexed' }).catch(() => undefined);
    expect(convert).toHaveBeenLastCalledWith('indexed', { maxColors: 256, dither: false });
  });

  it('leaves the current mode to the store, which does nothing, then refuses silently', async () => {
    const convert = vi.fn(realConvert);
    useEditorStore.setState({ convertColorMode: convert });
    const history = store().undoStack.length;
    const pending = runCommand('doc.color-mode', { mode: 'rgb' });
    expect(convert).toHaveBeenCalledWith('rgb', undefined);
    const error = await failure(pending);
    expect([error.code, error.notice, error.message]).toEqual(['refused', null, 'The document is already in RGB mode.']);
    expect(store().undoStack.length).toBe(history);
  });

  it('queues a second conversion to the same mode behind the first, as the menu does, and refuses it once its turn finds nothing to do', async () => {
    const first = runCommand('doc.color-mode', { mode: 'grayscale' });
    const second = runCommand('doc.color-mode', { mode: 'grayscale' });
    expect(await first).toEqual({ colorMode: 'grayscale' });
    const error = await failure(second);
    expect([error.code, error.notice, error.message]).toEqual(['refused', null, 'The document is already in Grayscale mode.']);
    expect(store().undoStack.filter((entry) => entry.label === 'Convert to Grayscale')).toHaveLength(1);
  });

  it('is checked for the document\'s mode, as Image > Mode is', async () => {
    const { getCommand } = await import('../registry');
    const command = getCommand('doc.color-mode');
    expect(command?.checked?.({ mode: 'rgb' })).toBe(true);
    expect(command?.checked?.({ mode: 'lab' })).toBe(false);
  });

  it('takes indexed options only for indexed, within the dialog\'s range', async () => {
    expect((await failure(runCommand('doc.color-mode', { mode: 'cmyk', dither: true }))).code).toBe('invalid');
    expect((await failure(runCommand('doc.color-mode', { mode: 'indexed', maxColors: 1 }))).code).toBe('invalid');
    expect((await failure(runCommand('doc.color-mode', { mode: 'indexed', maxColors: 257 }))).code).toBe('invalid');
  });

  it('is refused when the conversion did not happen', async () => {
    useEditorStore.setState({ convertColorMode: vi.fn(() => Promise.resolve(false)) });
    const error = await failure(runCommand('doc.color-mode', { mode: 'lab' }));
    expect([error.code, error.message]).toEqual(['refused', 'The document could not be converted to Lab.']);
  });
});
