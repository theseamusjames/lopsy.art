import { describe, it, expect } from 'vitest';
import { createTransformState, getHandlePositions, type TransformState } from './transform';
import { createTransformPointMapper, transformPolylines } from './transform-point';

const BOUNDS = { x: 100, y: 50, width: 200, height: 100 };

function distorted(): TransformState {
  return {
    ...createTransformState(BOUNDS, 'distort'),
    corners: [
      { x: 0, y: -40 },
      { x: -30, y: 0 },
      { x: -30, y: 20 },
      { x: 0, y: 60 },
    ],
  };
}

describe('createTransformPointMapper', () => {
  it('is the identity for an untouched transform', () => {
    const map = createTransformPointMapper(createTransformState(BOUNDS));
    expect(map(120, 70)).toEqual({ x: 120, y: 70 });
  });

  it('sends the selection corners onto the skewed handle box', () => {
    const state: TransformState = { ...createTransformState(BOUNDS, 'skew'), skewX: Math.PI / 8 };
    const map = createTransformPointMapper(state);
    const handles = getHandlePositions(state);
    const tl = map(BOUNDS.x, BOUNDS.y)!;
    const br = map(BOUNDS.x + BOUNDS.width, BOUNDS.y + BOUNDS.height)!;
    expect(tl.x).toBeCloseTo(handles['top-left'].x, 6);
    expect(tl.y).toBeCloseTo(handles['top-left'].y, 6);
    expect(br.x).toBeCloseTo(handles['bottom-right'].x, 6);
    expect(br.y).toBeCloseTo(handles['bottom-right'].y, 6);
  });

  it('sends the selection corners onto the distorted corners', () => {
    const state = distorted();
    const map = createTransformPointMapper(state);
    const handles = getHandlePositions(state);
    const corners = [
      [BOUNDS.x, BOUNDS.y, 'top-left'],
      [BOUNDS.x + BOUNDS.width, BOUNDS.y, 'top-right'],
      [BOUNDS.x + BOUNDS.width, BOUNDS.y + BOUNDS.height, 'bottom-right'],
      [BOUNDS.x, BOUNDS.y + BOUNDS.height, 'bottom-left'],
    ] as const;
    for (const [x, y, key] of corners) {
      const p = map(x, y)!;
      expect(p.x).toBeCloseTo(handles[key].x, 6);
      expect(p.y).toBeCloseTo(handles[key].y, 6);
    }
  });

  it('maps the bounds centre to the crossing of the quad diagonals (projective, not bilinear)', () => {
    const state = distorted();
    const map = createTransformPointMapper(state);
    const c = map(BOUNDS.x + BOUNDS.width / 2, BOUNDS.y + BOUNDS.height / 2)!;
    // Quad: TL (100,10) TR (270,50) BR (270,170) BL (100,210).
    // Diagonal TL→BR: (100,10)+t(170,160); diagonal TR→BL: (270,50)+s(−170,160).
    // x: 100+170t = 270−170s, y: 10+160t = 50+160s → t = 0.625.
    expect(c.x).toBeCloseTo(100 + 170 * 0.625, 6);
    expect(c.y).toBeCloseTo(10 + 160 * 0.625, 6);
  });
});

describe('transformPolylines', () => {
  it('maps every vertex of every polyline', () => {
    const state: TransformState = { ...createTransformState(BOUNDS), translateX: 5, translateY: -3 };
    const out = transformPolylines([[100, 50, 300, 50, 300, 150], [120, 60, 130, 60]], state);
    expect(out).toEqual([[105, 47, 305, 47, 305, 147], [125, 57, 135, 57]]);
  });

  it('traces the distorted outline of a rectangular selection', () => {
    const state = distorted();
    const rect = [100, 50, 300, 50, 300, 150, 100, 150, 100, 50];
    const [mapped] = transformPolylines([rect], state);
    expect(mapped).toHaveLength(rect.length);
    const expected = [100, 10, 270, 50, 270, 170, 100, 210, 100, 10];
    mapped!.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));
  });
});
