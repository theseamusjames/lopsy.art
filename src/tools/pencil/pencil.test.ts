import { describe, it, expect } from 'vitest';
import { bresenhamLine, defaultPencilSettings, snapToPixelUnderPointer } from './pencil';

describe('defaultPencilSettings', () => {
  it('returns size 1', () => {
    expect(defaultPencilSettings().size).toBe(1);
  });
});

describe('bresenhamLine', () => {
  it('horizontal line', () => {
    const points = bresenhamLine(0, 0, 4, 0);
    expect(points.length).toBe(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[4]).toEqual({ x: 4, y: 0 });
    for (const p of points) expect(p.y).toBe(0);
  });

  it('vertical line', () => {
    const points = bresenhamLine(0, 0, 0, 3);
    expect(points.length).toBe(4);
    for (const p of points) expect(p.x).toBe(0);
  });

  it('diagonal line', () => {
    const points = bresenhamLine(0, 0, 3, 3);
    expect(points.length).toBe(4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[3]).toEqual({ x: 3, y: 3 });
  });

  it('single point', () => {
    const points = bresenhamLine(5, 5, 5, 5);
    expect(points.length).toBe(1);
    expect(points[0]).toEqual({ x: 5, y: 5 });
  });
});

describe('snapToPixelUnderPointer', () => {
  it('paints the pixel under the pointer, not the rounded neighbour', () => {
    // Pointer at doc (800.6, 900.7): rounding gives 801,901; the pixel is 800,900.
    const snapped = snapToPixelUnderPointer({
      canvasPos: { x: 801, y: 901 },
      layerPos: { x: 801, y: 901 },
      pixelPos: { x: 800, y: 900 },
    });
    expect(snapped.canvasPos).toEqual({ x: 800, y: 900 });
    expect(snapped.layerPos).toEqual({ x: 800, y: 900 });
  });

  it('keeps the layer offset when converting to layer space', () => {
    const snapped = snapToPixelUnderPointer({
      canvasPos: { x: 121, y: 61 },
      layerPos: { x: 21, y: -39 },
      pixelPos: { x: 120, y: 60 },
    });
    expect(snapped.layerPos).toEqual({ x: 20, y: -40 });
  });

  it('floors the rounded position when no pixel position is known', () => {
    const snapped = snapToPixelUnderPointer({ canvasPos: { x: 5, y: 7 }, layerPos: { x: 5, y: 7 } });
    expect(snapped.canvasPos).toEqual({ x: 5, y: 7 });
  });

  it('passes the other context fields through', () => {
    const snapped = snapToPixelUnderPointer({
      canvasPos: { x: 2, y: 2 }, layerPos: { x: 2, y: 2 }, pixelPos: { x: 1, y: 1 }, shiftKey: true,
    });
    expect(snapped.shiftKey).toBe(true);
  });
});
