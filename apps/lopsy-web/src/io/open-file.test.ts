// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importPsdFile: vi.fn(),
  importDngFile: vi.fn(),
  importRafFile: vi.fn(),
  loadProjectOrThrow: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('./psd', () => ({ importPsdFile: mocks.importPsdFile }));
vi.mock('./dng', () => ({ importDngFile: mocks.importDngFile }));
vi.mock('./raf', () => ({ importRafFile: mocks.importRafFile }));
vi.mock('./project-load', () => ({ loadProjectOrThrow: mocks.loadProjectOrThrow }));
vi.mock('../app/notifications-store', () => ({
  notifyError: mocks.notifyError,
  describeError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock('../app/editor-store', () => ({ useEditorStore: { getState: () => ({}) } }));
vi.mock('../engine/bitmap-cache', () => ({ seedBitmapFromBlob: vi.fn() }));

const { isOpenableFileName, openFile, openFileOrThrow, OPEN_FILE_ACCEPT } = await import('./open-file');

afterEach(() => {
  vi.clearAllMocks();
});

describe('isOpenableFileName', () => {
  it('accepts the extensions the File > Open... picker lists, in any case', () => {
    expect(OPEN_FILE_ACCEPT).toBe('.jpg,.jpeg,.png,.gif,.bmp,.webp,.psd,.dng,.raf,.lopsy');
    for (const name of ['a.png', 'B.JPG', 'c.jpeg', 'd.Lopsy', 'e.psd', 'f.raf', 'g.dng', 'h.webp', 'i.gif', 'j.bmp']) {
      expect(isOpenableFileName(name)).toBe(true);
    }
    for (const name of ['notes.txt', 'noext', 'png', 'a.png.zip', 'a.tiff']) {
      expect(isOpenableFileName(name)).toBe(false);
    }
  });
});

describe('routing', () => {
  it('sends .psd, .dng and .raf bytes to their importers with the name less its extension', async () => {
    mocks.importPsdFile.mockResolvedValue(undefined);
    mocks.importDngFile.mockResolvedValue(undefined);
    mocks.importRafFile.mockResolvedValue(undefined);
    await openFileOrThrow(new File(['p'], 'Layers.PSD'));
    await openFileOrThrow(new File(['d'], 'shot.dng'));
    await openFileOrThrow(new File(['r'], 'shot.raf'));
    expect(mocks.importPsdFile.mock.calls[0]![1]).toBe('Layers');
    expect(Array.from(mocks.importPsdFile.mock.calls[0]![0] as Uint8Array)).toEqual([112]);
    expect(mocks.importDngFile.mock.calls[0]![1]).toBe('shot');
    expect(mocks.importRafFile.mock.calls[0]![1]).toBe('shot');
  });

  it('hands a project its fonts promise back', async () => {
    const fonts = Promise.resolve();
    mocks.loadProjectOrThrow.mockResolvedValue({ fonts });
    expect((await openFileOrThrow(new File(['x'], 'a.lopsy'))).fonts).toBe(fonts);
  });
});

describe('openFile and openFileOrThrow on failure', () => {
  const CASES = [
    { name: 'a.lopsy', fail: () => mocks.loadProjectOrThrow.mockRejectedValue(new Error('bad magic')), toast: 'Failed to load project: bad magic' },
    { name: 'a.psd', fail: () => mocks.importPsdFile.mockRejectedValue(new Error('bad psd')), toast: 'Failed to import PSD: bad psd' },
    { name: 'a.dng', fail: () => mocks.importDngFile.mockRejectedValue(new Error('bad dng')), toast: 'Failed to import DNG: bad dng' },
    { name: 'a.raf', fail: () => mocks.importRafFile.mockRejectedValue(new Error('bad raf')), toast: 'Failed to import RAF: bad raf' },
  ];

  for (const c of CASES) {
    it(`${c.name}: the menu toasts "${c.toast}" once; the throwing form rejects without a toast`, async () => {
      c.fail();
      await openFile(new File(['x'], c.name));
      expect(mocks.notifyError.mock.calls).toEqual([[c.toast]]);
      mocks.notifyError.mockClear();
      await expect(openFileOrThrow(new File(['x'], c.name))).rejects.toThrow();
      expect(mocks.notifyError).not.toHaveBeenCalled();
    });
  }
});
