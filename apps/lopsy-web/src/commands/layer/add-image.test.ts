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
  pasteOrOpenBlob: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../app/paste-or-open', () => ({ pasteOrOpenBlob: mocks.pasteOrOpenBlob }));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./add-image');

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

/** What pasteOrOpenBlob does to the store for an open document, without decoding. */
function pastesALayer(selected: Promise<void>) {
  mocks.pasteOrOpenBlob.mockImplementation(() => {
    store().addLayer();
    return Promise.resolve({ selected });
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

describe('layer.add-image', () => {
  it('hands the decoded bytes to pasteOrOpenBlob as a drop does, in the synchronous part', async () => {
    pastesALayer(Promise.resolve());
    const pending = runCommand('layer.add-image', { base64: btoa('png!'), name: 'photo.png' });
    expect(mocks.pasteOrOpenBlob).toHaveBeenCalledTimes(1);
    const [blob, name, forceNewDocument] = mocks.pasteOrOpenBlob.mock.calls[0]! as [Blob, string, boolean | undefined];
    expect(await blob.text()).toBe('png!');
    expect(name).toBe('photo');
    expect(forceNewDocument).toBeUndefined();
    const { id } = (await pending) as { id: string };
    expect(id).toBe(store().document.activeLayerId);
  });

  it('resolves only once the pasted pixels are selected, and closes the New Document dialog as a drop does', async () => {
    let select: () => void = () => undefined;
    pastesALayer(new Promise((resolve) => { select = resolve; }));
    useUIStore.getState().openModal({ kind: 'newDocument' });
    let isDone = false;
    const pending = runCommand('layer.add-image', { base64: btoa('x'), name: 'a.png' }).then(() => { isDone = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isDone).toBe(false);
    expect(useUIStore.getState().modal).toBeNull();
    select();
    await pending;
    expect(isDone).toBe(true);
  });

  it('rejects an undecodable image as invalid with the reason', async () => {
    mocks.pasteOrOpenBlob.mockRejectedValue(new Error('The source image cannot be decoded.'));
    expect(await failure(runCommand('layer.add-image', { base64: btoa('x'), name: 'bad.png' }))).toMatchObject({
      code: 'invalid',
      message: 'layer.add-image: could not decode "bad.png" as an image: The source image cannot be decoded.',
    });
  });

  it('rejects malformed base64 and needs a document and an engine, without pasting', async () => {
    expect((await failure(runCommand('layer.add-image', { base64: 'a', name: 'a.png' }))).message).toBe(
      'layer.add-image: base64 is not valid base64',
    );
    mocks.engine = null;
    expect((await failure(runCommand('layer.add-image', { base64: btoa('x'), name: 'a.png' }))).code).toBe('unavailable');
    useEditorStore.setState({ documentReady: false });
    expect((await failure(runCommand('layer.add-image', { base64: btoa('x'), name: 'a.png' }))).code).toBe('unavailable');
    useEditorStore.setState({ documentReady: true });
    expect(mocks.pasteOrOpenBlob).not.toHaveBeenCalled();
  });
});
