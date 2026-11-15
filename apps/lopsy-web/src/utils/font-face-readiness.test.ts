import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ensureFontFacesLoaded,
  normalizeFamilyName,
  onFontFacesLoaded,
  parseFontFamilyList,
  resetFontFaceReadinessForTests,
} from './font-face-readiness';

interface FakeFontFaceSet {
  loaded: Set<string>;
  loads: string[];
  listeners: Array<(e: { fontfaces: Array<{ family: string }> }) => void>;
  failLoads: boolean;
  check: (font: string) => boolean;
  load: (font: string) => Promise<unknown[]>;
  addEventListener: (type: string, fn: (e: { fontfaces: Array<{ family: string }> }) => void) => void;
  removeEventListener: (type: string, fn: (e: { fontfaces: Array<{ family: string }> }) => void) => void;
}

function installFonts(): FakeFontFaceSet {
  const set: FakeFontFaceSet = {
    loaded: new Set(),
    loads: [],
    listeners: [],
    failLoads: false,
    check: (font) => set.loaded.has(font),
    load: (font) => {
      set.loads.push(font);
      if (set.failLoads) return Promise.reject(new Error('network'));
      set.loaded.add(font);
      return Promise.resolve([]);
    },
    addEventListener: (_type, fn) => {
      set.listeners.push(fn);
    },
    removeEventListener: (_type, fn) => {
      set.listeners = set.listeners.filter((l) => l !== fn);
    },
  };
  (globalThis as { document?: unknown }).document = { fonts: set };
  return set;
}

describe('parseFontFamilyList', () => {
  it('unquotes, trims and lower-cases each family', () => {
    expect(parseFontFamilyList(`'IM Fell English', serif`)).toEqual(['im fell english', 'serif']);
    expect(parseFontFamilyList(`"Open Sans",sans-serif`)).toEqual(['open sans', 'sans-serif']);
    expect(normalizeFamilyName(`"Montserrat"`)).toBe('montserrat');
  });
});

describe('ensureFontFacesLoaded', () => {
  let fonts: FakeFontFaceSet;

  beforeEach(() => {
    resetFontFaceReadinessForTests();
    fonts = installFonts();
  });

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('reports ready without loading when the faces are already loaded', () => {
    fonts.loaded.add('400 48px Inter');
    const onSettled = vi.fn();
    expect(ensureFontFacesLoaded('400 48px Inter', 'Hi', onSettled)).toBe(true);
    expect(fonts.loads).toEqual([]);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('loads missing faces and calls back once they settle', async () => {
    const onSettled = vi.fn();
    expect(ensureFontFacesLoaded(`400 48px 'IM Fell English'`, 'Hi', onSettled)).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(fonts.loads).toEqual([`400 48px 'IM Fell English'`]);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(ensureFontFacesLoaded(`400 48px 'IM Fell English'`, 'Hi', onSettled)).toBe(true);
  });

  it('requests a failing font only once so redraws cannot loop', async () => {
    fonts.failLoads = true;
    const onSettled = vi.fn();
    ensureFontFacesLoaded('400 48px Broken', 'Hi', onSettled);
    await Promise.resolve();
    await Promise.resolve();
    ensureFontFacesLoaded('400 48px Broken', 'Hi', onSettled);
    await Promise.resolve();
    expect(fonts.loads).toHaveLength(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe('onFontFacesLoaded', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('reports the normalized families of faces that finished loading', () => {
    const fonts = installFonts();
    const listener = vi.fn();
    const unsubscribe = onFontFacesLoaded(listener);
    fonts.listeners.forEach((l) => l({ fontfaces: [{ family: '"IM Fell English"' }] }));
    expect(listener).toHaveBeenCalledWith(['im fell english']);

    unsubscribe();
    expect(fonts.listeners).toHaveLength(0);
  });
});
