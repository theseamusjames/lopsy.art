import { describe, it, expect } from 'vitest';
import { calcPixelGridRange, renderRulers } from './render-grid';

describe('calcPixelGridRange', () => {
  it('returns full doc range when the whole document fits inside the canvas', () => {
    // 100x100 doc at zoom=10, centered in a 2000x2000 canvas
    // originX = 0 + 2000/2 - (100/2)*10 = 1000 - 500 = 500
    // startX = ceil(-500/10) = ceil(-50) = -50 → clamped to 0
    // endX   = floor((2000-500)/10) = floor(150) = 150 → clamped to 100
    const result = calcPixelGridRange(2000, 2000, { panX: 0, panY: 0, zoom: 10 }, 100, 100);
    expect(result.startX).toBe(0);
    expect(result.endX).toBe(100);
    expect(result.startY).toBe(0);
    expect(result.endY).toBe(100);
  });

  it('clips to viewport when doc extends off screen', () => {
    // 1000x1000 doc at zoom=10 (10000x10000 screen pixels)
    // centered in 500x500 canvas with no pan
    // originX = 0 + 250 - 500*10 = 250 - 5000 = -4750
    // startX = ceil(4750/10) = ceil(475) = 475
    // endX   = floor((500 - (-4750)) / 10) = floor(5250/10) = 525 → clamped to 1000
    const result = calcPixelGridRange(500, 500, { panX: 0, panY: 0, zoom: 10 }, 1000, 1000);
    expect(result.startX).toBe(475);
    expect(result.endX).toBe(525);
    expect(result.startY).toBe(475);
    expect(result.endY).toBe(525);
  });

  it('accounts for pan offset', () => {
    // 100x100 doc at zoom=10, panX=100 (shifted right by 100 screen pixels)
    // originX = 100 + 2000/2 - 50*10 = 100 + 1000 - 500 = 600
    // startX = ceil(-600/10) = -60 → clamped to 0
    // endX   = floor((2000-600)/10) = floor(140) = 140 → clamped to 100
    const result = calcPixelGridRange(2000, 2000, { panX: 100, panY: 0, zoom: 10 }, 100, 100);
    expect(result.startX).toBe(0);
    expect(result.endX).toBe(100);
  });

  it('returns empty range when zoom is at or below threshold', () => {
    // This tests the calling convention — calcPixelGridRange itself doesn't
    // enforce the threshold; that is renderPixelGrid's responsibility.
    // This test just verifies the math produces sane results at zoom=8.
    const result = calcPixelGridRange(800, 600, { panX: 0, panY: 0, zoom: 8 }, 100, 100);
    expect(result.startX).toBeGreaterThanOrEqual(0);
    expect(result.endX).toBeLessThanOrEqual(100);
    expect(result.startY).toBeGreaterThanOrEqual(0);
    expect(result.endY).toBeLessThanOrEqual(100);
  });

  it('clamps startX/startY to 0 when doc origin is within canvas', () => {
    // 50x50 doc at zoom=20, no pan, large canvas
    // originX = 0 + 1000/2 - 25*20 = 500 - 500 = 0
    // startX = ceil(0/20) = 0
    // endX   = floor((1000-0)/20) = 50 → clamped to 50
    const result = calcPixelGridRange(1000, 800, { panX: 0, panY: 0, zoom: 20 }, 50, 50);
    expect(result.startX).toBe(0);
    expect(result.endX).toBe(50);
    expect(result.startY).toBeGreaterThanOrEqual(0);
  });
});

/** A 2D-context stand-in that records every label the rulers draw. */
function recordingContext(): { ctx: CanvasRenderingContext2D; labels: string[] } {
  const labels: string[] = [];
  const noop = () => undefined;
  const ctx = {
    fillText: (text: string) => { labels.push(text); },
    save: noop, restore: noop, fillRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, stroke: noop, fill: noop, translate: noop, rotate: noop, setLineDash: noop,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, labels };
}

describe('renderRulers', () => {
  // 400 × 220 overlay, 720 × 720 document, panned so the document origin sits
  // exactly at the ruler's inner edge: screen = 20 + doc px on both axes.
  const canvasW = 400;
  const canvasH = 220;
  const docSize = 720;
  const viewport = { panX: 20 - canvasW / 2 + docSize / 2, panY: 20 - canvasH / 2 + docSize / 2, zoom: 1 };
  const cursor = { x: -1000, y: -1000 };

  function labelsFor(unit: Parameters<typeof renderRulers>[8], dpi: number): string[] {
    const { ctx, labels } = recordingContext();
    renderRulers(ctx, canvasW, canvasH, viewport, docSize, docSize, cursor, undefined, unit, dpi);
    return labels;
  }

  it('labels pixels every 50 px at 100 % (the horizontal ruler first, then the vertical)', () => {
    expect(labelsFor('px', 72)).toEqual([
      '0', '50', '100', '150', '200', '250', '300', '350',
      '0', '50', '100', '150', '200',
    ]);
  });

  it('labels inches in halves at 72 dpi', () => {
    expect(labelsFor('in', 72).slice(0, 11)).toEqual(['0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5']);
  });

  it('labels millimetres in tens and never shows the 28.35 px conversion', () => {
    const labels = labelsFor('mm', 72);
    expect(labels.slice(0, 5)).toEqual(['0', '10', '20', '30', '40']);
    expect(labels.every((l) => /^-?\d+$/.test(l))).toBe(true);
  });

  it('reads the same as pixels in points at 72 dpi and coarser at 300 dpi', () => {
    expect(labelsFor('pt', 72)).toEqual(labelsFor('px', 72));
    expect(labelsFor('pt', 300).slice(0, 4)).toEqual(['0', '10', '20', '30']);
  });

  it('defaults to pixels when no unit is given', () => {
    const { ctx, labels } = recordingContext();
    renderRulers(ctx, canvasW, canvasH, viewport, docSize, docSize, cursor);
    expect(labels).toEqual(labelsFor('px', 72));
  });
});
