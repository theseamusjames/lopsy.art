import { describe, expect, it } from 'vitest';
import { clampPan, fitView, fitZoom, limitSize, panBy, zoomAround, type View } from './viewport';

const VIEW = { width: 1000, height: 800 };

describe('fitZoom', () => {
  it('shrinks a large image to fit inside the padding', () => {
    expect(fitZoom({ width: 4000, height: 2000 }, VIEW, 0)).toBeCloseTo(0.25);
    expect(fitZoom({ width: 1000, height: 4000 }, VIEW, 0)).toBeCloseTo(0.2);
  });

  it('never enlarges', () => {
    expect(fitZoom({ width: 100, height: 100 }, VIEW)).toBe(1);
  });

  it('answers 1 for empty sizes', () => {
    expect(fitZoom({ width: 0, height: 0 }, VIEW)).toBe(1);
  });
});

describe('zoomAround', () => {
  it('keeps the anchored image point still', () => {
    const start: View = { zoom: 0.5, panX: 30, panY: -10, isFit: false };
    const anchor = { x: 700, y: 200 };
    const imageX = (anchor.x - VIEW.width / 2 - start.panX) / start.zoom;
    const imageY = (anchor.y - VIEW.height / 2 - start.panY) / start.zoom;
    const next = zoomAround(start, 2, VIEW, anchor);
    expect(next.zoom).toBe(2);
    expect(next.isFit).toBe(false);
    expect(imageX * next.zoom + VIEW.width / 2 + next.panX).toBeCloseTo(anchor.x);
    expect(imageY * next.zoom + VIEW.height / 2 + next.panY).toBeCloseTo(anchor.y);
  });

  it('zooms about the centre without an anchor', () => {
    const next = zoomAround(fitView({ width: 2000, height: 2000 }, VIEW), 1, VIEW);
    expect(next.panX).toBe(0);
    expect(next.panY).toBe(0);
  });
});

describe('pan', () => {
  it('moves and stops before the image leaves the view', () => {
    const start: View = { zoom: 1, panX: 0, panY: 0, isFit: true };
    const image = { width: 2000, height: 1000 };
    const moved = panBy(start, 50, -20, image, VIEW);
    expect(moved).toEqual({ zoom: 1, panX: 50, panY: -20, isFit: false });
    const far = clampPan({ ...start, panX: 99999, panY: -99999 }, image, VIEW);
    expect(far.panX).toBe((2000 + 1000) / 2 - 32);
    expect(far.panY).toBe(-((1000 + 800) / 2 - 32));
  });
});

describe('limitSize', () => {
  it('fits the long edge and never enlarges', () => {
    expect(limitSize({ width: 4000, height: 3000 }, 512)).toEqual({ width: 512, height: 384 });
    expect(limitSize({ width: 300, height: 200 }, 512)).toEqual({ width: 300, height: 200 });
    expect(limitSize({ width: 300, height: 200 }, undefined)).toEqual({ width: 300, height: 200 });
  });
});
