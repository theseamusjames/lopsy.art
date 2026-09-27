import { describe, it, expect } from 'vitest';
import { collectTextLayerFonts } from './load-document-fonts';
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
