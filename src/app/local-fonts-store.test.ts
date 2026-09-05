import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const engineMock = { id: 'engine' };
const getEngine = vi.fn(() => engineMock as unknown);
const isFontLoaded = vi.fn((_engine: unknown, _family: string) => false);
const loadFontData = vi.fn((_engine: unknown, _bytes: Uint8Array) => undefined);

vi.mock('../engine-wasm/engine-state', () => ({ getEngine: () => getEngine() }));
vi.mock('../engine-wasm/wasm-bridge', () => ({
  isFontLoaded: (engine: unknown, family: string) => isFontLoaded(engine, family),
  loadFontData: (engine: unknown, bytes: Uint8Array) => loadFontData(engine, bytes),
}));

import {
  useLocalFontsStore,
  findFontEntry,
  loadLocalFontToEngine,
  type LocalFontData,
} from './local-fonts-store';

function face(family: string, style: string, bytes: number[] = [1, 2, 3]): LocalFontData {
  return {
    family,
    style,
    fullName: `${family} ${style}`,
    postscriptName: `${family}-${style}`.replace(/\s+/g, ''),
    blob: async () => new Blob([new Uint8Array(bytes)]),
  };
}

type WindowSlot = { window?: { queryLocalFonts?: () => Promise<LocalFontData[]> } };
const g = globalThis as unknown as WindowSlot;

function stubWindow(query?: () => Promise<LocalFontData[]>): void {
  g.window = query ? { queryLocalFonts: query } : {};
}

describe('local-fonts-store', () => {
  beforeEach(() => {
    useLocalFontsStore.setState({ status: 'idle', entries: [], byFamily: new Map(), error: null });
    getEngine.mockReturnValue(engineMock);
    isFontLoaded.mockReset().mockReturnValue(false);
    loadFontData.mockReset();
  });

  afterEach(() => {
    delete g.window;
  });

  it('reports unsupported when the API is absent', async () => {
    stubWindow(undefined);
    await useLocalFontsStore.getState().loadLocalFonts();
    expect(useLocalFontsStore.getState().status).toBe('unsupported');
    expect(useLocalFontsStore.getState().entries).toEqual([]);
  });

  it('groups the returned faces into entries and indexes them by family', async () => {
    stubWindow(async () => [
      face('Avenida Std', 'Regular'),
      face('Helvetica Neue', 'Bold'),
      face('Helvetica Neue', 'Regular'),
      face('Helvetica Neue', 'Light Italic'),
    ]);
    await useLocalFontsStore.getState().loadLocalFonts();
    const state = useLocalFontsStore.getState();
    expect(state.status).toBe('ready');
    expect(state.entries.map((e) => e.family)).toEqual(['Avenida Std', 'Helvetica Neue']);
    expect(state.byFamily.get('Helvetica Neue')).toMatchObject({ weights: [300, 400, 700], hasItalic: true, source: 'local' });
  });

  it('records a failure (and keeps no entries) when the query rejects', async () => {
    stubWindow(async () => {
      throw new DOMException('User denied', 'NotAllowedError');
    });
    await useLocalFontsStore.getState().loadLocalFonts();
    const state = useLocalFontsStore.getState();
    expect(state.status).toBe('failed');
    expect(state.error).toBe('User denied');
    expect(state.entries).toEqual([]);
  });

  it('retries once the tab becomes visible after a hidden-tab rejection', async () => {
    const query = vi.fn<() => Promise<LocalFontData[]>>()
      .mockRejectedValueOnce(new DOMException('Page needs to be visible.', 'SecurityError'))
      .mockResolvedValueOnce([face('Avenida Std', 'Regular')]);
    stubWindow(query);
    const listeners: Array<() => void> = [];
    const doc = { visibilityState: 'hidden', addEventListener: vi.fn((_: string, cb: () => void) => listeners.push(cb)) };
    (globalThis as unknown as { document?: unknown }).document = doc;
    try {
      await useLocalFontsStore.getState().loadLocalFonts();
      expect(useLocalFontsStore.getState().status).toBe('failed');
      expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function), { once: true });

      doc.visibilityState = 'visible';
      listeners.forEach((cb) => cb());
      await vi.waitFor(() => expect(useLocalFontsStore.getState().status).toBe('ready'));
      expect(query).toHaveBeenCalledTimes(2);
      expect(useLocalFontsStore.getState().entries.map((e) => e.family)).toEqual(['Avenida Std']);
    } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  });

  it('does not wait for visibility when the rejection happened on a visible tab', async () => {
    stubWindow(async () => {
      throw new DOMException('User denied', 'NotAllowedError');
    });
    const doc = { visibilityState: 'visible', addEventListener: vi.fn() };
    (globalThis as unknown as { document?: unknown }).document = doc;
    try {
      await useLocalFontsStore.getState().loadLocalFonts();
      expect(doc.addEventListener).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  });

  it('ignores a second call while a query is in flight', async () => {
    let resolveQuery: (faces: LocalFontData[]) => void = () => undefined;
    const query = vi.fn(() => new Promise<LocalFontData[]>((resolve) => { resolveQuery = resolve; }));
    stubWindow(query);
    const first = useLocalFontsStore.getState().loadLocalFonts();
    const second = useLocalFontsStore.getState().loadLocalFonts();
    resolveQuery([face('Avenida Std', 'Regular')]);
    await Promise.all([first, second]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(useLocalFontsStore.getState().status).toBe('ready');
  });

  it('findFontEntry prefers an installed family over the static catalog', async () => {
    expect(findFontEntry('Arial')?.source).toBe('system');
    expect(findFontEntry('Pacifico')?.source).toBe('google');
    stubWindow(async () => [face('Arial', 'Regular'), face('Arial', 'Bold Italic')]);
    await useLocalFontsStore.getState().loadLocalFonts();
    expect(findFontEntry('Arial')?.source).toBe('local');
    expect(findFontEntry('Pacifico')?.source).toBe('google');
    expect(findFontEntry('Nope')).toBeUndefined();
  });

  it('loadLocalFontToEngine pushes every face of the family and reports a fresh load', async () => {
    stubWindow(async () => [
      face('Helvetica Neue', 'Regular', [1]),
      face('Helvetica Neue', 'Bold', [2, 2]),
      face('Avenida Std', 'Regular', [3, 3, 3]),
    ]);
    await useLocalFontsStore.getState().loadLocalFonts();
    isFontLoaded.mockReturnValueOnce(false).mockReturnValue(true);

    await expect(loadLocalFontToEngine('Helvetica Neue')).resolves.toBe(true);
    expect(loadFontData).toHaveBeenCalledTimes(2);
    const sizes = loadFontData.mock.calls.map(([, bytes]) => bytes.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('loadLocalFontToEngine is a no-op for unknown or already-loaded families', async () => {
    stubWindow(async () => [face('Avenida Std', 'Regular')]);
    await useLocalFontsStore.getState().loadLocalFonts();

    await expect(loadLocalFontToEngine('Pacifico')).resolves.toBe(false);
    isFontLoaded.mockReturnValue(true);
    await expect(loadLocalFontToEngine('Avenida Std')).resolves.toBe(false);
    expect(loadFontData).not.toHaveBeenCalled();
  });

  it('loadLocalFontToEngine reports false when the engine cannot parse the bytes', async () => {
    stubWindow(async () => [face('Broken', 'Regular')]);
    await useLocalFontsStore.getState().loadLocalFonts();
    isFontLoaded.mockReturnValue(false);
    await expect(loadLocalFontToEngine('Broken')).resolves.toBe(false);
    expect(loadFontData).toHaveBeenCalledTimes(1);
  });
});
