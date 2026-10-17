import { describe, it, expect } from 'vitest';
import { pathStrokeBounds, tracePath, type PathAnchor, type PathSink } from './path';

function anchor(x: number, y: number, handleOut: PathAnchor['handleOut'] = null): PathAnchor {
  return { point: { x, y }, handleIn: null, handleOut };
}

function recordingSink(): PathSink & { calls: Array<[string, ...number[]]> } {
  const calls: Array<[string, ...number[]]> = [];
  return {
    calls,
    moveTo: (x, y) => { calls.push(['moveTo', x, y]); },
    bezierCurveTo: (a, b, c, d, x, y) => { calls.push(['bezierCurveTo', a, b, c, d, x, y]); },
  };
}

describe('tracePath', () => {
  it('emits one bézier per segment, using handles where set', () => {
    const sink = recordingSink();
    tracePath(sink, [anchor(0, 0, { x: 5, y: -5 }), anchor(10, 0)], false);
    expect(sink.calls).toEqual([
      ['moveTo', 0, 0],
      ['bezierCurveTo', 5, -5, 10, 0, 10, 0],
    ]);
  });

  it('closes the path back to the first anchor and applies the offset', () => {
    const sink = recordingSink();
    tracePath(sink, [anchor(0, 0), anchor(10, 0), anchor(10, 10)], true, 100, 200);
    expect(sink.calls).toEqual([
      ['moveTo', 100, 200],
      ['bezierCurveTo', 100, 200, 110, 200, 110, 200],
      ['bezierCurveTo', 110, 200, 110, 210, 110, 210],
      ['bezierCurveTo', 110, 210, 100, 200, 100, 200],
    ]);
  });

  it('draws nothing for an empty path', () => {
    const sink = recordingSink();
    tracePath(sink, [], true);
    expect(sink.calls).toEqual([]);
  });
});

describe('pathStrokeBounds', () => {
  it('pads the anchors by half the stroke width plus a pixel', () => {
    expect(pathStrokeBounds([anchor(100, 50), anchor(200, 50)], 4)).toEqual({
      x: 97, y: 47, width: 106, height: 6,
    });
  });

  it('includes bézier handles, which bound the curve', () => {
    const bounds = pathStrokeBounds([anchor(0, 0, { x: 50, y: 80 }), anchor(100, 0)], 2)!;
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(82);
  });

  it('is null for an empty path', () => {
    expect(pathStrokeBounds([], 4)).toBeNull();
  });
});
