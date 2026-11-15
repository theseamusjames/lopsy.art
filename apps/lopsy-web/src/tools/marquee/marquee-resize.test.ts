import { describe, it, expect } from 'vitest';
import { marqueeResizeRatio, resizeMarqueeBounds } from './marquee-resize';

const box = { x: 100, y: 100, width: 160, height: 90 };

describe('resizeMarqueeBounds', () => {
  it('moves only the dragged edges when unconstrained', () => {
    expect(resizeMarqueeBounds('right', box, 40, 25, null)).toEqual({ x: 100, y: 100, width: 200, height: 90 });
    expect(resizeMarqueeBounds('top-left', box, -10, 20, null)).toEqual({ x: 90, y: 120, width: 170, height: 70 });
  });

  it('keeps the opposite corner fixed and never flips', () => {
    expect(resizeMarqueeBounds('bottom-right', box, -500, -500, null)).toEqual({ x: 100, y: 100, width: 1, height: 1 });
    expect(resizeMarqueeBounds('top-left', box, 500, 500, null)).toEqual({ x: 259, y: 189, width: 1, height: 1 });
  });

  it('fits a corner drag inside the pointer rectangle at the ratio', () => {
    // 16:9 box dragged wider than tall: height decides.
    expect(resizeMarqueeBounds('bottom-right', box, 200, 0, 16 / 9)).toEqual({ x: 100, y: 100, width: 160, height: 90 });
    expect(resizeMarqueeBounds('bottom-right', box, 160, 90, 16 / 9)).toEqual({ x: 100, y: 100, width: 320, height: 180 });
    // Anchored at the bottom-right when dragging the top-left corner.
    expect(resizeMarqueeBounds('top-left', box, -160, -200, 16 / 9)).toEqual({ x: -60, y: 10, width: 320, height: 180 });
  });

  it('resizes the other side about the centre on an edge drag', () => {
    expect(resizeMarqueeBounds('bottom', box, 0, 90, 16 / 9)).toEqual({ x: 20, y: 100, width: 320, height: 180 });
    expect(resizeMarqueeBounds('left', box, 80, 0, 16 / 9)).toEqual({ x: 180, y: 123, width: 80, height: 45 });
  });

  it('applies a ratio that differs from the box shape', () => {
    const r = resizeMarqueeBounds('bottom-right', box, 40, 40, 1);
    expect(r.width).toBe(r.height);
  });
});

describe('marqueeResizeRatio', () => {
  it('uses the locked ratio when the lock is on', () => {
    expect(marqueeResizeRatio(box, { isLocked: true, ratioW: 4, ratioH: 3, isProportional: false })).toBeCloseTo(4 / 3);
  });

  it('keeps the box shape with Cmd held and no lock', () => {
    expect(marqueeResizeRatio(box, { isLocked: false, ratioW: 4, ratioH: 3, isProportional: true })).toBeCloseTo(16 / 9);
  });

  it('is unconstrained otherwise, or with an invalid lock', () => {
    expect(marqueeResizeRatio(box, { isLocked: false, ratioW: 4, ratioH: 3, isProportional: false })).toBeNull();
    expect(marqueeResizeRatio(box, { isLocked: true, ratioW: 0, ratioH: 3, isProportional: false })).toBeNull();
  });
});
