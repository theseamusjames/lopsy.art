import { describe, it, expect } from 'vitest';
import { computeLayerMove, computeNudge, snapToGuide, computeAlign, getContentBounds, computeFit } from './move';

describe('computeLayerMove', () => {
  it('calculates correct delta', () => {
    const result = computeLayerMove({ x: 10, y: 20 }, { x: 15, y: 25 }, 100, 200);
    expect(result).toEqual({ x: 105, y: 205 });
  });

  it('handles negative movement', () => {
    const result = computeLayerMove({ x: 10, y: 10 }, { x: 5, y: 3 }, 50, 50);
    expect(result).toEqual({ x: 45, y: 43 });
  });
});

describe('computeNudge', () => {
  it('nudges up', () => {
    expect(computeNudge('up', 1, 50, 50)).toEqual({ x: 50, y: 49 });
  });

  it('nudges down', () => {
    expect(computeNudge('down', 10, 50, 50)).toEqual({ x: 50, y: 60 });
  });

  it('nudges left', () => {
    expect(computeNudge('left', 1, 50, 50)).toEqual({ x: 49, y: 50 });
  });

  it('nudges right', () => {
    expect(computeNudge('right', 5, 50, 50)).toEqual({ x: 55, y: 50 });
  });
});

describe('computeAlign', () => {
  const bounds = { x: 10, y: 20, width: 30, height: 40 };
  const canvasW = 200;
  const canvasH = 100;
  const layerX = 10;
  const layerY = 20;

  it('aligns left', () => {
    const result = computeAlign('left', bounds, canvasW, canvasH, layerX, layerY);
    expect(result).toEqual({ x: 0, y: 20 });
  });

  it('aligns center horizontally', () => {
    const result = computeAlign('center-h', bounds, canvasW, canvasH, layerX, layerY);
    expect(result).toEqual({ x: 85, y: 20 });
  });

  it('aligns right', () => {
    const result = computeAlign('right', bounds, canvasW, canvasH, layerX, layerY);
    expect(result).toEqual({ x: 170, y: 20 });
  });

  it('aligns top', () => {
    const result = computeAlign('top', bounds, canvasW, canvasH, layerX, layerY);
    expect(result).toEqual({ x: 10, y: 0 });
  });

  it('aligns center vertically', () => {
    const result = computeAlign('center-v', bounds, canvasW, canvasH, layerX, layerY);
    expect(result).toEqual({ x: 10, y: 30 });
  });

  it('aligns bottom', () => {
    const result = computeAlign('bottom', bounds, canvasW, canvasH, layerX, layerY);
    expect(result).toEqual({ x: 10, y: 60 });
  });

  it('handles offset content within layer', () => {
    const offsetBounds = { x: 25, y: 30, width: 30, height: 40 };
    const result = computeAlign('left', offsetBounds, canvasW, canvasH, 10, 20);
    expect(result).toEqual({ x: -15, y: 20 });
  });
});

describe('getContentBounds', () => {
  function makePixelData(w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  it('returns null for empty layer', () => {
    const data = makePixelData(10, 10);
    expect(getContentBounds(data, 0, 0)).toBeNull();
  });

  it('finds bounds of opaque pixels', () => {
    const data = makePixelData(10, 10);
    for (let y = 3; y < 5; y++) {
      for (let x = 2; x < 5; x++) {
        const idx = (y * 10 + x) * 4;
        data.data[idx] = 255;
        data.data[idx + 1] = 0;
        data.data[idx + 2] = 0;
        data.data[idx + 3] = 255;
      }
    }
    const result = getContentBounds(data, 10, 20);
    expect(result).toEqual({ x: 12, y: 23, width: 3, height: 2 });
  });
});

describe('snapToGuide', () => {
  it('snaps when within threshold', () => {
    const result = snapToGuide(102, [100, 200, 300], 5);
    expect(result).toEqual({ snapped: true, value: 100 });
  });

  it('does not snap when outside threshold', () => {
    const result = snapToGuide(110, [100, 200, 300], 5);
    expect(result).toEqual({ snapped: false, value: 110 });
  });

  it('snaps to nearest guide within threshold', () => {
    const result = snapToGuide(199, [100, 200, 300], 5);
    expect(result).toEqual({ snapped: true, value: 200 });
  });

  it('picks the closer of two guides in reach, whatever their order', () => {
    expect(snapToGuide(103, [100, 104], 5)).toEqual({ snapped: true, value: 104 });
    expect(snapToGuide(103, [104, 100], 5)).toEqual({ snapped: true, value: 104 });
  });
});

describe('computeFit', () => {
  // Issue #347: pasted/dropped image overflowing the canvas. Fit scales the
  // longest side to the canvas while preserving aspect ratio and centers it.
  it('shrinks a wide image so its width matches the canvas', () => {
    const fit = computeFit(4000, 2000, 1024, 1024);
    expect(fit.width).toBe(1024);
    expect(fit.height).toBe(512);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(256);
  });

  it('shrinks a tall image so its height matches the canvas', () => {
    const fit = computeFit(2000, 4000, 1024, 1024);
    expect(fit.width).toBe(512);
    expect(fit.height).toBe(1024);
    expect(fit.x).toBe(256);
    expect(fit.y).toBe(0);
  });

  it('scales up a small image to fit the canvas', () => {
    const fit = computeFit(100, 100, 1024, 1024);
    expect(fit.width).toBe(1024);
    expect(fit.height).toBe(1024);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(0);
  });

  it('handles non-square canvases', () => {
    const fit = computeFit(2000, 1000, 800, 600);
    // Scale = min(800/2000, 600/1000) = min(0.4, 0.6) = 0.4 — width-bound.
    expect(fit.width).toBe(800);
    expect(fit.height).toBe(400);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(100);
  });

  it('returns the input unchanged for zero-sized content', () => {
    const fit = computeFit(0, 100, 1024, 1024);
    expect(fit.width).toBe(0);
  });
});
