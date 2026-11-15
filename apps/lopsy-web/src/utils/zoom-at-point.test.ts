import { describe, expect, it } from 'vitest';
import { zoomAtPoint, type ViewTransform } from './zoom-at-point';

const SCREEN = { width: 800, height: 600 };
const DOC = { width: 400, height: 300 };

// Mirrors the viewport mapping used by the renderer and screenToCanvas.
function screenToDoc(vt: ViewTransform, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - vt.panX - SCREEN.width / 2) / vt.zoom + DOC.width / 2,
    y: (y - vt.panY - SCREEN.height / 2) / vt.zoom + DOC.height / 2,
  };
}

describe('zoomAtPoint', () => {
  it('keeps the document point under the cursor fixed', () => {
    const from = { zoom: 1, panX: 30, panY: -20 };
    const cursor = { x: 610, y: 140 };
    const before = screenToDoc(from, cursor.x, cursor.y);
    const next = zoomAtPoint(from, 2.5, cursor, SCREEN);
    const after = screenToDoc(next, cursor.x, cursor.y);
    expect(next.zoom).toBe(2.5);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('leaves pan unchanged when zooming at the screen centre', () => {
    const next = zoomAtPoint({ zoom: 1, panX: 0, panY: 0 }, 3, { x: 400, y: 300 }, SCREEN);
    expect(next).toEqual({ zoom: 3, panX: 0, panY: 0 });
  });

  it('moves the anchored point to the target when the pinch centre drifts', () => {
    const from = { zoom: 0.5, panX: 10, panY: 10 };
    const anchor = { x: 300, y: 200 };
    const target = { x: 350, y: 260 };
    const before = screenToDoc(from, anchor.x, anchor.y);
    const next = zoomAtPoint(from, 1.5, anchor, SCREEN, target);
    const after = screenToDoc(next, target.x, target.y);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom and computes pan for the clamped value', () => {
    const from = { zoom: 60, panX: 0, panY: 0 };
    const cursor = { x: 700, y: 500 };
    const before = screenToDoc(from, cursor.x, cursor.y);
    const next = zoomAtPoint(from, 200, cursor, SCREEN);
    expect(next.zoom).toBe(64);
    const after = screenToDoc(next, cursor.x, cursor.y);
    expect(after.x).toBeCloseTo(before.x);
  });
});
