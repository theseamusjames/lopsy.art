import { describe, it, expect } from 'vitest';
import { serializeLayer } from './project-save';
import { deserializeLayer } from './project-load';
import { DEFAULT_EFFECTS } from '../layers/layer-model';
import type { TextLayer } from '../types/layers';

function makeText(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: 't1',
    name: 'Text',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 347,
    y: 118,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    text: 'AROUND THE CIRCLE',
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 400,
    fontStyle: 'normal',
    color: { r: 0, g: 0, b: 0, a: 1 },
    lineHeight: 1.4,
    letterSpacing: 0,
    paragraphSpacing: 0,
    textAlign: 'left',
    width: null,
    underline: false,
    strikethrough: false,
    ...overrides,
  };
}

function roundTrip(layer: TextLayer): TextLayer {
  const serialized = serializeLayer(layer, -1, -1, 0, 0);
  const reparsed = JSON.parse(JSON.stringify(serialized));
  return deserializeLayer(reparsed) as TextLayer;
}

describe('text layer save/load round-trip', () => {
  it('keeps the text-on-path binding (#966)', () => {
    const loaded = roundTrip(makeText({ pathId: 'path-47a7', prePathX: 40, prePathY: 40 }));
    expect(loaded.pathId).toBe('path-47a7');
    expect(loaded.prePathX).toBe(40);
    expect(loaded.prePathY).toBe(40);
  });

  it('leaves unbound text unbound', () => {
    const loaded = roundTrip(makeText());
    expect(loaded.pathId).toBeUndefined();
    expect('pathId' in loaded).toBe(false);
  });

  it('keeps a text transform', () => {
    const transform = { a: 0, b: 1.5, c: -1.5, d: 0, anchorX: 12.25, anchorY: -3 };
    expect(roundTrip(makeText({ transform })).transform).toEqual(transform);
  });

  it('leaves upright text without a transform', () => {
    expect('transform' in roundTrip(makeText())).toBe(false);
  });
});
