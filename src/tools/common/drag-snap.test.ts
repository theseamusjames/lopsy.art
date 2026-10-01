import { describe, it, expect } from 'vitest';
import { snapDragPoint, type DragSnapOptions } from './drag-snap';

const base: DragSnapOptions = {
  grid: null,
  verticalGuides: [],
  horizontalGuides: [],
  guideThreshold: 8,
};

describe('snapDragPoint', () => {
  it('leaves the point alone with no grid and no guides', () => {
    expect(snapDragPoint({ x: 13.4, y: 27.9 }, base)).toEqual({ x: 13.4, y: 27.9 });
  });

  it('snaps x to a vertical guide and y to a horizontal one, independently', () => {
    const opts = { ...base, verticalGuides: [100], horizontalGuides: [50] };
    expect(snapDragPoint({ x: 95, y: 20 }, opts)).toEqual({ x: 100, y: 20 });
    expect(snapDragPoint({ x: 20, y: 57 }, opts)).toEqual({ x: 20, y: 50 });
    expect(snapDragPoint({ x: 108, y: 42 }, opts)).toEqual({ x: 100, y: 50 });
  });

  it('does not snap past the threshold', () => {
    const opts = { ...base, verticalGuides: [100] };
    expect(snapDragPoint({ x: 91.9, y: 0 }, opts)).toEqual({ x: 91.9, y: 0 });
  });

  it('a vertical guide never pulls y, nor a horizontal one x', () => {
    const opts = { ...base, verticalGuides: [10], horizontalGuides: [90] };
    expect(snapDragPoint({ x: 90, y: 10 }, opts)).toEqual({ x: 90, y: 10 });
  });

  it('falls back to the centered grid on an axis with no guide in reach', () => {
    const opts: DragSnapOptions = {
      ...base,
      grid: { size: 16, docWidth: 200, docHeight: 200 },
      verticalGuides: [37],
    };
    // Grid lines sit at 100 ± 16k: … 36, 52 … on both axes.
    expect(snapDragPoint({ x: 33, y: 47 }, opts)).toEqual({ x: 37, y: 52 });
  });
});
