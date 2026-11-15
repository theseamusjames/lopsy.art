import { describe, expect, it } from 'vitest';
import {
  translateGuidesForCanvas,
  translatePathsForCanvas,
  translateTextLayerForCanvas,
} from './translate-canvas-overlays';
import { resizeCanvasOffset } from './resize-canvas';
import { createTextLayer } from '../../../layers/layer-model';

describe('translatePathsForCanvas (#1598)', () => {
  it('shifts anchors and handles by the canvas offset', () => {
    const [path] = translatePathsForCanvas([{
      id: 'p', name: 'Path', closed: false,
      anchors: [
        { point: { x: 200, y: 300 }, handleIn: null, handleOut: { x: 250, y: 280 } },
        { point: { x: 600, y: 300 }, handleIn: { x: 550, y: 320 }, handleOut: null },
      ],
    }], 100, 100);
    expect(path!.anchors[0]).toEqual({ point: { x: 300, y: 400 }, handleIn: null, handleOut: { x: 350, y: 380 } });
    expect(path!.anchors[1]).toEqual({ point: { x: 700, y: 400 }, handleIn: { x: 650, y: 420 }, handleOut: null });
  });

  it('moves paths up-left for a crop', () => {
    const [path] = translatePathsForCanvas([{
      id: 'p', name: 'Path', closed: true,
      anchors: [{ point: { x: 200, y: 300 }, handleIn: null, handleOut: null }],
    }], -200, -100);
    expect(path!.anchors[0]!.point).toEqual({ x: 0, y: 200 });
    expect(path!.closed).toBe(true);
  });
});

describe('translateGuidesForCanvas (#1598)', () => {
  const guides = [
    { id: 'v', orientation: 'vertical' as const, position: 400 },
    { id: 'h', orientation: 'horizontal' as const, position: 300 },
  ];

  it('shifts vertical guides by dx and horizontal guides by dy', () => {
    expect(translateGuidesForCanvas(guides, 100, 100)).toEqual([
      { id: 'v', orientation: 'vertical', position: 500 },
      { id: 'h', orientation: 'horizontal', position: 400 },
    ]);
    expect(translateGuidesForCanvas(guides, -200, -100)).toEqual([
      { id: 'v', orientation: 'vertical', position: 200 },
      { id: 'h', orientation: 'horizontal', position: 200 },
    ]);
  });

  it('keeps guides that end up outside the canvas', () => {
    const moved = translateGuidesForCanvas(guides, -500, 0);
    expect(moved[0]!.position).toBe(-100);
  });
});

describe('translateTextLayerForCanvas (#1598)', () => {
  it('moves a path-bound layer and its path anchor together, keeping the user offset', () => {
    const layer = { ...createTextLayer({ name: 'T', text: 'Hi' }), x: 210, y: 290, pathId: 'p', pathAnchorX: 200, pathAnchorY: 300 };
    const moved = translateTextLayerForCanvas(layer, 100, 100);
    expect(moved).toMatchObject({ x: 310, y: 390, pathAnchorX: 300, pathAnchorY: 400 });
    expect(moved.x - moved.pathAnchorX!).toBe(layer.x - layer.pathAnchorX);
  });

  it('leaves the anchor unset on a free text layer', () => {
    const layer = { ...createTextLayer({ name: 'T', text: 'Hi' }), x: 10, y: 20 };
    const moved = translateTextLayerForCanvas(layer, -5, 7);
    expect(moved.x).toBe(5);
    expect(moved.y).toBe(27);
    expect(moved.pathAnchorX).toBeUndefined();
  });
});

describe('resizeCanvasOffset', () => {
  it('centres the old canvas for a centre anchor', () => {
    expect(resizeCanvasOffset({ width: 800, height: 600 }, 1000, 800, 0.5, 0.5)).toEqual({ x: 100, y: 100 });
  });

  it('keeps the top-left corner for a top-left anchor', () => {
    expect(resizeCanvasOffset({ width: 800, height: 600 }, 1000, 800, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});
