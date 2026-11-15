import { beforeEach, describe, it, expect, vi } from 'vitest';
import { collectTextLayerFonts, loadDocumentFonts } from './load-document-fonts';

const localState = { isQueried: false };
const loadLocalFontsIfGranted = vi.fn(async () => { localState.isQueried = true; });

vi.mock('./local-fonts-store', () => ({
  findFontEntry: (family: string) => {
    if (family === 'Missing') return undefined;
    if (family === 'Installed') return localState.isQueried ? { source: 'local', weights: [400], hasItalic: false } : undefined;
    return { source: 'google', weights: [400], hasItalic: false };
  },
  loadLocalFontToEngine: (family: string) => Promise.resolve(family === 'Installed'),
  useLocalFontsStore: { getState: () => ({ loadLocalFontsIfGranted }) },
}));

vi.mock('../utils/font-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/font-loader')>()),
  loadGoogleFont: () => Promise.resolve(),
  loadFontBinaryToEngine: (family: string) => Promise.resolve(family !== 'Broken'),
}));
import type { Layer } from '../types/layers';

function textLayer(id: string, fontFamily: string, fontWeight: number, fontStyle: 'normal' | 'italic' = 'normal'): Layer {
  return { id, type: 'text', fontFamily, fontWeight, fontStyle } as unknown as Layer;
}

describe('collectTextLayerFonts', () => {
  it('returns one face per distinct family / weight / style among text layers', () => {
    const layers: Layer[] = [
      textLayer('a', 'Arvo, serif', 400),
      textLayer('b', 'Arvo, serif', 400),
      textLayer('c', 'Arvo, serif', 700),
      textLayer('d', "'Josefin Sans', sans-serif", 400, 'italic'),
      { id: 'r', type: 'raster' } as unknown as Layer,
    ];

    expect(collectTextLayerFonts(layers)).toEqual([
      { family: 'Arvo', weight: 400, isItalic: false },
      { family: 'Arvo', weight: 700, isItalic: false },
      { family: 'Josefin Sans', weight: 400, isItalic: true },
    ]);
  });

  it('returns nothing for a document without text layers', () => {
    expect(collectTextLayerFonts([{ id: 'r', type: 'raster' } as unknown as Layer])).toEqual([]);
  });
});

describe('loadDocumentFonts', () => {
  it('reports each family whose face reached the engine, and only those (#1213)', async () => {
    const loaded: string[] = [];
    await loadDocumentFonts(
      [
        textLayer('a', 'Arvo, serif', 400),
        textLayer('b', 'Broken, serif', 400),
        textLayer('c', 'Missing, serif', 400),
      ],
      (family) => loaded.push(family),
    );
    expect(loaded).toEqual(['Arvo']);
  });

  describe('installed fonts (#1642)', () => {
    beforeEach(() => {
      localState.isQueried = false;
      loadLocalFontsIfGranted.mockClear();
    });

    it('enumerates installed fonts (without prompting) only for a family the catalog lacks', async () => {
      const loaded: string[] = [];
      await loadDocumentFonts([textLayer('a', 'Arvo, serif', 400)], (family) => loaded.push(family));
      expect(loadLocalFontsIfGranted).not.toHaveBeenCalled();

      await loadDocumentFonts([textLayer('b', 'Installed, serif', 400)], (family) => loaded.push(family));
      expect(loadLocalFontsIfGranted).toHaveBeenCalledTimes(1);
      expect(loaded).toEqual(['Arvo', 'Installed']);
    });
  });
});
