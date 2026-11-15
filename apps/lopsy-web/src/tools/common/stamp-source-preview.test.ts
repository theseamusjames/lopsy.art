import { describe, it, expect } from 'vitest';
import { stampPreviewDisc, stampSourceCenter, type StampPreviewInput } from './stamp-source-preview';

const base: StampPreviewInput = {
  isStampTool: true,
  activeLayerId: 'layer-1',
  isCursorOnCanvas: true,
  cursor: { x: 250, y: 200 },
  brushSize: 40,
  stamp: { source: { x: 50, y: 60 }, offset: null },
};

describe('stampSourceCenter', () => {
  it('is null until a source is set', () => {
    expect(stampSourceCenter({ source: null, offset: null }, { x: 1, y: 2 })).toBeNull();
  });

  it('is the Alt-clicked point before the first stroke fixes an offset', () => {
    expect(stampSourceCenter({ source: { x: 50, y: 60 }, offset: null }, { x: 250, y: 200 })).toEqual({ x: 50, y: 60 });
  });

  it('follows the cursor at the stroke offset once one is set', () => {
    expect(stampSourceCenter({ source: { x: 50, y: 60 }, offset: { x: -200, y: -140 } }, { x: 300, y: 210 }))
      .toEqual({ x: 100, y: 70 });
  });
});

describe('stampPreviewDisc', () => {
  it('previews the active layer around the source, at the brush radius', () => {
    expect(stampPreviewDisc(base)).toEqual({
      layerId: 'layer-1',
      cursor: { x: 250, y: 200 },
      source: { x: 50, y: 60 },
      radius: 20,
    });
  });

  it('shows nothing with no source set, so hovering never asks the engine for anything', () => {
    expect(stampPreviewDisc({ ...base, stamp: { source: null, offset: null } })).toBeNull();
  });

  it('shows nothing for other tools, off the canvas, or without an active layer', () => {
    expect(stampPreviewDisc({ ...base, isStampTool: false })).toBeNull();
    expect(stampPreviewDisc({ ...base, isCursorOnCanvas: false })).toBeNull();
    expect(stampPreviewDisc({ ...base, activeLayerId: null })).toBeNull();
  });
});
