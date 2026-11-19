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
  engine: {} as object | null,
  encodeDocumentImage: vi.fn(),
  serializeProject: vi.fn(),
  encodePsdFile: vi.fn(),
  openFileOrThrow: vi.fn(),
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../../io/export-image', () => ({ encodeDocumentImage: mocks.encodeDocumentImage }));
vi.mock('../../io/project-save', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../io/project-save')>();
  return { ...actual, serializeProject: mocks.serializeProject };
});
vi.mock('../../io/psd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../io/psd')>();
  return { ...actual, encodePsdFile: mocks.encodePsdFile };
});
vi.mock('../../io/open-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../io/open-file')>();
  return { ...actual, openFileOrThrow: mocks.openFileOrThrow };
});

const { useEditorStore } = await import('../../app/editor-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const { ImageDecodeError } = await import('../../io/open-file');
await import('./files');

function store() {
  return useEditorStore.getState();
}

function base64(text: string): string {
  return btoa(text);
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

const PIXELS = new Uint8Array([1, 2, 3, 250]);

/** Store actions upload to whatever engine getEngine returns, so the stand-in engine steps aside for them. */
function withoutEngine(action: () => void): void {
  const engine = mocks.engine;
  mocks.engine = null;
  action();
  mocks.engine = engine;
}

function pushBaseline(): void {
  withoutEngine(() => store().pushHistory('New Document'));
}

beforeEach(() => {
  mocks.engine = {};
  withoutEngine(() => store().createDocument(40, 30, false));
  pushBaseline();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('doc.export', () => {
  it('encodes with the dialog\'s settings in the synchronous part and returns base64', async () => {
    mocks.encodeDocumentImage.mockResolvedValue({ bytes: PIXELS, mime: 'image/jpeg', ext: 'jpg', width: 40, height: 30 });
    const pending = runCommand('doc.export', { format: 'jpeg', quality: 40 });
    expect(mocks.encodeDocumentImage).toHaveBeenCalledWith({ format: 'jpeg', quality: 40, highQuality: false });
    expect(await pending).toEqual({ mime: 'image/jpeg', ext: 'jpg', width: 40, height: 30, base64: btoa(String.fromCharCode(...PIXELS)) });
  });

  it('defaults lossy quality to 92 and passes 100 for lossless formats, as the dialog does', async () => {
    mocks.encodeDocumentImage.mockResolvedValue({ bytes: PIXELS, mime: 'image/png', ext: 'png', width: 40, height: 30 });
    await runCommand('doc.export', { format: 'webp' });
    await runCommand('doc.export', { format: 'png', highQuality: true });
    expect(mocks.encodeDocumentImage.mock.calls.map(([settings]) => settings)).toEqual([
      { format: 'webp', quality: 92, highQuality: false },
      { format: 'png', quality: 100, highQuality: true },
    ]);
  });

  it('rejects quality for lossless formats and highQuality for non-PNG, without encoding', async () => {
    expect((await failure(runCommand('doc.export', { format: 'bmp', quality: 50 }))).message).toBe(
      'doc.export: quality applies to jpeg and webp only, not bmp',
    );
    expect((await failure(runCommand('doc.export', { format: 'webp', highQuality: false }))).message).toBe(
      'doc.export: highQuality applies to png only, not webp',
    );
    expect((await failure(runCommand('doc.export', { format: 'jpeg', quality: 101 }))).code).toBe('invalid');
    expect(mocks.encodeDocumentImage).not.toHaveBeenCalled();
  });

  it('is unavailable with an empty composite, no engine or no document', async () => {
    mocks.encodeDocumentImage.mockResolvedValue(null);
    expect((await failure(runCommand('doc.export', { format: 'png' }))).code).toBe('unavailable');
    mocks.engine = null;
    expect((await failure(runCommand('doc.export', { format: 'png' }))).code).toBe('unavailable');
    useEditorStore.setState({ documentReady: false });
    expect((await failure(runCommand('doc.export', { format: 'png' }))).code).toBe('unavailable');
    useEditorStore.setState({ documentReady: true });
  });

  it('does not mark the document clean', async () => {
    mocks.encodeDocumentImage.mockResolvedValue({ bytes: PIXELS, mime: 'image/png', ext: 'png', width: 40, height: 30 });
    useEditorStore.setState({ isDirty: true });
    await runCommand('doc.export', { format: 'png' });
    expect(store().isDirty).toBe(true);
  });
});

describe('doc.save and doc.export-psd', () => {
  it('doc.save serializes in the synchronous part and returns the .lopsy bytes, leaving the dirty flag', async () => {
    mocks.serializeProject.mockResolvedValue(PIXELS);
    useEditorStore.setState({ isDirty: true });
    const pending = runCommand('doc.save');
    expect(mocks.serializeProject).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ mime: 'application/octet-stream', ext: 'lopsy', base64: btoa(String.fromCharCode(...PIXELS)) });
    expect(store().isDirty).toBe(true);
  });

  it('doc.save passes a serialization failure through', async () => {
    mocks.serializeProject.mockRejectedValue(new Error('read failed'));
    await expect(runCommand('doc.save')).rejects.toThrow('read failed');
  });

  it('doc.export-psd encodes at 16 bits by default, 8 when asked, and rejects other depths', async () => {
    mocks.encodePsdFile.mockResolvedValue(PIXELS);
    const pending = runCommand('doc.export-psd');
    expect(mocks.encodePsdFile).toHaveBeenCalledWith(16);
    expect(await pending).toEqual({ mime: 'application/octet-stream', ext: 'psd', base64: btoa(String.fromCharCode(...PIXELS)) });
    await runCommand('doc.export-psd', { depth: 8 });
    expect(mocks.encodePsdFile).toHaveBeenLastCalledWith(8);
    expect((await failure(runCommand('doc.export-psd', { depth: 12 }))).message).toBe('doc.export-psd: depth must be 8 or 16, got 12');
    expect(mocks.encodePsdFile).toHaveBeenCalledTimes(2);
  });

  it('both need an engine', async () => {
    mocks.engine = null;
    expect((await failure(runCommand('doc.save'))).code).toBe('unavailable');
    expect((await failure(runCommand('doc.export-psd'))).code).toBe('unavailable');
  });
});

describe('doc.open', () => {
  function opensDocument(fonts: Promise<void> = Promise.resolve()) {
    mocks.openFileOrThrow.mockImplementation(() => {
      withoutEngine(() => store().createDocument(64, 48, true));
      return Promise.resolve({ fonts });
    });
  }

  it('opens a File named as given in the synchronous part, then returns the new document once it has its baseline', async () => {
    opensDocument();
    const pending = runCommand('doc.open', { base64: base64('png bytes'), name: 'probe.png' });
    const file = mocks.openFileOrThrow.mock.calls[0]![0] as File;
    expect(file.name).toBe('probe.png');
    expect(await file.text()).toBe('png bytes');
    pushBaseline();
    const result = (await pending) as { width: number; height: number; layers: Array<{ name: string }> };
    expect({ width: result.width, height: result.height }).toEqual({ width: 64, height: 48 });
    expect(result.layers.map((l) => l.name)).toEqual(['Background', 'Project']);
  });

  it('waits for the opened project\'s fonts', async () => {
    let fontsLoaded: () => void = () => undefined;
    opensDocument(new Promise((resolve) => { fontsLoaded = resolve; }));
    let isDone = false;
    const pending = runCommand('doc.open', { base64: base64('x'), name: 'a.lopsy' }).then(() => { isDone = true; });
    pushBaseline();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isDone).toBe(false);
    fontsLoaded();
    await pending;
    expect(isDone).toBe(true);
  });

  it('rejects an unsupported name and malformed base64 without opening anything', async () => {
    const unsupported = await failure(runCommand('doc.open', { base64: base64('x'), name: 'notes.txt' }));
    expect(unsupported.code).toBe('invalid');
    expect(unsupported.message).toContain('"notes.txt" is not a type File > Open... opens');
    expect((await failure(runCommand('doc.open', { base64: base64('x'), name: 'noext' }))).code).toBe('invalid');
    expect(await failure(runCommand('doc.open', { base64: '***', name: 'a.png' }))).toMatchObject({
      code: 'invalid',
      message: 'doc.open: base64 is not valid base64',
    });
    expect(mocks.openFileOrThrow).not.toHaveBeenCalled();
  });

  it('turns a loader failure into invalid with its reason', async () => {
    mocks.openFileOrThrow.mockRejectedValueOnce(new Error('Not a valid .lopsy file — missing magic bytes.'));
    expect(await failure(runCommand('doc.open', { base64: base64('x'), name: 'a.lopsy' }))).toMatchObject({
      code: 'invalid',
      message: 'doc.open: could not open "a.lopsy": Not a valid .lopsy file — missing magic bytes.',
    });
    mocks.openFileOrThrow.mockRejectedValueOnce(new ImageDecodeError('b.png'));
    expect((await failure(runCommand('doc.open', { base64: base64('x'), name: 'b.png' }))).message).toBe(
      'doc.open: could not open "b.png": the browser could not decode it as an image',
    );
  });

  it('is unavailable when the loader opened nothing', async () => {
    mocks.openFileOrThrow.mockResolvedValue({ fonts: Promise.resolve() });
    expect((await failure(runCommand('doc.open', { base64: base64('x'), name: 'c.png' }))).code).toBe('unavailable');
  });
});
