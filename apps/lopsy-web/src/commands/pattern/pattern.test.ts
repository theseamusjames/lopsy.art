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
  definePattern: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../app/MenuBar/pattern-actions', () => ({ definePattern: mocks.definePattern }));

const { useEditorStore } = await import('../../app/editor-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./pattern');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

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

const PATTERN = { id: 'pattern-1', name: 'Pattern 1', width: 20, height: 10, data: new Uint8Array(800), thumbnail: '' };

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(40, 30, false);
  mocks.engine = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('pattern.define', () => {
  it('calls Edit > Define Pattern\'s definePattern in the synchronous part and returns the pattern', async () => {
    mocks.definePattern.mockResolvedValue(PATTERN);
    const pending = runCommand('pattern.define');
    expect(mocks.definePattern).toHaveBeenCalledWith(undefined);
    expect(await pending).toEqual({ id: 'pattern-1', name: 'Pattern 1', width: 20, height: 10 });
  });

  it('passes a name through', async () => {
    mocks.definePattern.mockResolvedValue({ ...PATTERN, name: 'Bricks' });
    expect(await runCommand('pattern.define', { name: 'Bricks' })).toMatchObject({ name: 'Bricks' });
    expect(mocks.definePattern).toHaveBeenCalledWith('Bricks');
  });

  it('refuses when nothing was captured', async () => {
    mocks.definePattern.mockResolvedValue(null);
    expect(await failure(runCommand('pattern.define'))).toMatchObject({
      code: 'refused',
      message: 'Nothing was captured: the active layer has no pixels inside the selection (or at all).',
    });
  });

  it('refuses a text layer with the toast the menu shows, without defining', async () => {
    patchActive({ type: 'text' });
    const error = await failure(runCommand('pattern.define'));
    expect([error.code, error.notice, error.message]).toEqual(['refused', 'info', 'Text layers must be rasterized before they can be painted on.']);
    expect(mocks.definePattern).not.toHaveBeenCalled();
  });

  it('is unavailable without an engine, and rejects an empty name', async () => {
    mocks.engine = null;
    expect((await failure(runCommand('pattern.define'))).code).toBe('unavailable');
    mocks.engine = {};
    expect((await failure(runCommand('pattern.define', { name: '' }))).code).toBe('invalid');
    expect(mocks.definePattern).not.toHaveBeenCalled();
  });
});
