import { describe, expect, it } from 'vitest';
import type { QuarterTurns } from '@lopsy/photos-core/library/recipe';
import {
  FULL_RECT,
  aspectRatio,
  clampRect,
  cropPixels,
  dragCrop,
  fitAspect,
  inscribedScale,
  inverseRotation,
  levelAngle,
  rotatedBounds,
  straightenedCrop,
  fromFramed,
  isFullCrop,
  recipeCrop,
  toFramed,
  type FramingLike,
  type Rect,
} from './crop';

function close(a: Rect, b: Rect) {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.width).toBeCloseTo(b.width, 9);
  expect(a.height).toBeCloseTo(b.height, 9);
}

const ALL: FramingLike[] = ([0, 90, 180, 270] as QuarterTurns[]).flatMap((rotate) => [
  { rotate, flipH: false },
  { rotate, flipH: true },
]);

/** The top-left quarter of the source, with a marker inside it. */
const TOP_LEFT: Rect = { x: 0, y: 0, width: 0.5, height: 0.25 };

describe('toFramed / fromFramed', () => {
  it('are inverses for every framing', () => {
    const r: Rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.5 };
    for (const f of ALL) close(fromFramed(toFramed(r, f), f), r);
  });

  it('move the source top-left where the framing puts it', () => {
    close(toFramed(TOP_LEFT, { rotate: 0, flipH: false }), TOP_LEFT);
    // A clockwise quarter turn puts the top edge on the right.
    close(toFramed(TOP_LEFT, { rotate: 90, flipH: false }), { x: 0.75, y: 0, width: 0.25, height: 0.5 });
    close(toFramed(TOP_LEFT, { rotate: 180, flipH: false }), { x: 0.5, y: 0.75, width: 0.5, height: 0.25 });
    close(toFramed(TOP_LEFT, { rotate: 270, flipH: false }), { x: 0, y: 0.5, width: 0.25, height: 0.5 });
    close(toFramed(TOP_LEFT, { rotate: 0, flipH: true }), { x: 0.5, y: 0, width: 0.5, height: 0.25 });
    close(toFramed(TOP_LEFT, { rotate: 90, flipH: true }), { x: 0, y: 0, width: 0.25, height: 0.5 });
  });
});

describe('recipeCrop', () => {
  it('stores the crop in source space, and nothing for the whole image', () => {
    const framing: FramingLike = { rotate: 90, flipH: false };
    const stored = recipeCrop({ x: 0.75, y: 0, width: 0.25, height: 0.5 }, framing);
    expect(stored).toEqual({ x: 0, y: 0, width: 0.5, height: 0.25 });
    expect(recipeCrop(FULL_RECT, framing)).toBeNull();
  });
});

describe('clampRect and isFullCrop', () => {
  it('keeps the rectangle inside the image', () => {
    expect(clampRect({ x: 0.9, y: -0.2, width: 0.3, height: 1.5 })).toEqual({ x: 0.7, y: 0, width: 0.3, height: 1 });
    expect(clampRect({ x: 0.5, y: 0.5, width: 0, height: 0.001 }).width).toBeGreaterThan(0);
    expect(isFullCrop(null)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, width: 1, height: 0.9 })).toBe(false);
  });
});

describe('cropPixels', () => {
  it('rounds to whole pixels inside the image', () => {
    expect(cropPixels({ x: 0.25, y: 0.1, width: 0.5, height: 0.8 }, 640, 480)).toEqual({ x: 160, y: 48, width: 320, height: 384 });
    expect(cropPixels({ x: 0.999, y: 0, width: 0.0001, height: 1 }, 100, 100).width).toBe(1);
  });
});

describe('aspect', () => {
  it('gives landscape ratios, turned for portrait', () => {
    expect(aspectRatio('free', 1.5, false)).toBeNull();
    expect(aspectRatio('3:2', 1, false)).toBeCloseTo(1.5);
    expect(aspectRatio('3:2', 1, true)).toBeCloseTo(2 / 3);
    expect(aspectRatio('4:5', 1, true)).toBeCloseTo(0.8);
    expect(aspectRatio('1:1', 2, true)).toBe(1);
    expect(aspectRatio('original', 4 / 3, false)).toBeCloseTo(4 / 3);
    expect(aspectRatio('original', 2 / 3, true)).toBeCloseTo(2 / 3);
  });

  it('fits a square inside a 640x480 image', () => {
    const r = fitAspect(FULL_RECT, 1, 640 / 480);
    expect(r.height).toBeCloseTo(1);
    expect(r.width).toBeCloseTo(0.75);
    expect(r.x).toBeCloseTo(0.125);
    const px = cropPixels(r, 640, 480);
    expect(px.width).toBe(px.height);
  });
});

describe('dragCrop', () => {
  const start: Rect = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

  it('moves inside the image', () => {
    close(dragCrop(start, 'move', 0.5, -0.5, null, 1), { x: 0.6, y: 0, width: 0.4, height: 0.4 });
  });

  it('resizes freely from a corner, keeping the opposite corner', () => {
    close(dragCrop(start, 'se', 0.1, 0.2, null, 1), { x: 0.2, y: 0.2, width: 0.5, height: 0.6 });
    close(dragCrop(start, 'nw', -0.1, 0.1, null, 1), { x: 0.1, y: 0.3, width: 0.5, height: 0.3 });
  });

  it('keeps the aspect, in pixels, on a non-square image', () => {
    const imageAspect = 640 / 480;
    const r = dragCrop(start, 'se', 0.2, 0.05, 1, imageAspect);
    expect((r.width * 640) / (r.height * 480)).toBeCloseTo(1, 9);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.y).toBeCloseTo(0.2);
    expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('stops at the image edge with the aspect kept', () => {
    const r = dragCrop(start, 'se', 2, 2, 1, 1);
    expect(r.width).toBeCloseTo(0.8);
    expect(r.height).toBeCloseTo(0.8);
  });

  it('grows about the centre from an edge handle', () => {
    const r = dragCrop(start, 'e', 0.2, 0, 1, 1);
    expect(r.width).toBeCloseTo(0.6);
    expect(r.height).toBeCloseTo(0.6);
    expect(r.y + r.height / 2).toBeCloseTo(0.4);
  });
});

describe('straighten', () => {
  it('keeps the whole frame at 0 and shrinks as the angle grows', () => {
    expect(inscribedScale(640, 480, 0)).toBe(1);
    const k5 = inscribedScale(640, 480, 5);
    const k10 = inscribedScale(640, 480, -10);
    expect(k5).toBeLessThan(1);
    expect(k10).toBeLessThan(k5);
  });

  it('fits the inscribed rectangle inside the turned image', () => {
    const w = 640;
    const h = 480;
    for (const deg of [3, 12, 30, -20]) {
      const k = inscribedScale(w, h, deg);
      const t = (deg * Math.PI) / 180;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const x = (sx * k * w) / 2;
        const y = (sy * k * h) / 2;
        const xr = x * Math.cos(t) + y * Math.sin(t);
        const yr = -x * Math.sin(t) + y * Math.cos(t);
        expect(Math.abs(xr)).toBeLessThanOrEqual(w / 2 + 1e-6);
        expect(Math.abs(yr)).toBeLessThanOrEqual(h / 2 + 1e-6);
      }
    }
  });

  it('keeps a user crop inside the inscribed rectangle', () => {
    expect(straightenedCrop(null, 0, 640, 480)).toBeNull();
    const k = inscribedScale(640, 480, 10);
    const r = straightenedCrop(null, 10, 640, 480);
    expect(r?.width).toBeCloseTo(k);
    expect(r?.x).toBeCloseTo((1 - k) / 2);
    const user = straightenedCrop({ x: 0, y: 0.4, width: 0.5, height: 0.2 }, 10, 640, 480);
    expect(user?.x).toBeCloseTo((1 - k) / 2);
    expect(user?.y).toBeCloseTo(0.4);
  });

  it('builds the inverse turn and the turned bounds', () => {
    expect(Array.from(inverseRotation(0)).map((v) => v + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const r = rotatedBounds(100, 50, 90);
    expect(r.width).toBe(50);
    expect(r.height).toBe(100);
    expect(r.x).toBe(25);
  });

  it('levels a drawn line', () => {
    expect(levelAngle({ x: 0, y: 0 }, { x: 100, y: 10 })).toBeCloseTo(-5.71, 1);
    expect(levelAngle({ x: 0, y: 0 }, { x: 100, y: -10 })).toBeCloseTo(5.71, 1);
    expect(levelAngle({ x: 0, y: 0 }, { x: 5, y: 100 })).toBeCloseTo(2.86, 1);
    expect(levelAngle({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });
});
