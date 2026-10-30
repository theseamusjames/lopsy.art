import { describe, expect, it } from 'vitest';
import { rotateDocumentPoint, rotateGuidesForCanvas, rotatePathsForCanvas } from './rotate-image-overlays';

describe('rotateDocumentPoint', () => {
  it('turns CW as (x, y) → (H − y, x)', () => {
    expect(rotateDocumentPoint({ x: 100, y: 500 }, 'cw', 800, 600)).toEqual({ x: 100, y: 100 });
  });

  it('turns CCW as (x, y) → (y, W − x)', () => {
    expect(rotateDocumentPoint({ x: 100, y: 500 }, 'ccw', 800, 600)).toEqual({ x: 500, y: 700 });
  });

  it('CW then CCW is the identity', () => {
    const p = { x: 123, y: 45 };
    const cw = rotateDocumentPoint(p, 'cw', 800, 600);
    expect(rotateDocumentPoint(cw, 'ccw', 600, 800)).toEqual(p);
  });
});

describe('rotatePathsForCanvas (#1401)', () => {
  it('turns anchors and handles with the canvas', () => {
    const [path] = rotatePathsForCanvas([{
      id: 'p', name: 'Path', closed: false,
      anchors: [
        { point: { x: 100, y: 500 }, handleIn: null, handleOut: { x: 200, y: 450 } },
        { point: { x: 700, y: 500 }, handleIn: { x: 650, y: 550 }, handleOut: null },
      ],
    }], 'cw', 800, 600);
    expect(path!.anchors[0]).toEqual({ point: { x: 100, y: 100 }, handleIn: null, handleOut: { x: 150, y: 200 } });
    expect(path!.anchors[1]).toEqual({ point: { x: 100, y: 700 }, handleIn: { x: 50, y: 650 }, handleOut: null });
  });
});

describe('rotateGuidesForCanvas (#1401)', () => {
  const guides = [
    { id: 'v', orientation: 'vertical' as const, position: 200 },
    { id: 'h', orientation: 'horizontal' as const, position: 100 },
  ];

  it('CW turns a vertical guide horizontal at the same offset and a horizontal one vertical at H − y', () => {
    expect(rotateGuidesForCanvas(guides, 'cw', 800, 600)).toEqual([
      { id: 'v', orientation: 'horizontal', position: 200 },
      { id: 'h', orientation: 'vertical', position: 500 },
    ]);
  });

  it('CCW turns a vertical guide horizontal at W − x and a horizontal one vertical at the same offset', () => {
    expect(rotateGuidesForCanvas(guides, 'ccw', 800, 600)).toEqual([
      { id: 'v', orientation: 'horizontal', position: 600 },
      { id: 'h', orientation: 'vertical', position: 100 },
    ]);
  });
});
