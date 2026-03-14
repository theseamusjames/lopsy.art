import { describe, it, expect } from 'vitest';
import { computeLayerMove, computeNudge, snapToGuide, computeAlign, getContentBounds } from './move';

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
});
