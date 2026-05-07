import { describe, it, expect } from 'vitest';
import { computeLayerMove, computeNudge, snapToGuide, computeAlign, getContentBounds, snapPositionToLayers, computeFit } from './move';
import type { Layer } from '../../types';
import { DEFAULT_EFFECTS } from '../../layers/layer-model';

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

describe('snapPositionToLayers', () => {
  function makeRasterLayer(id: string, x: number, y: number, w: number, h: number): Layer {
    return {
      id,
      name: id,
      type: 'raster',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x,
      y,
      width: w,
      height: h,
      clipToBelow: false,
      effects: DEFAULT_EFFECTS,
      mask: null,
    };
  }

  const threshold = 5;

  it('does not snap when no layers are nearby', () => {
    const other = makeRasterLayer('b', 200, 200, 50, 50);
    const result = snapPositionToLayers(10, 10, 50, 50, [other], threshold);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
    expect(result.snapLinesX).toHaveLength(0);
    expect(result.snapLinesY).toHaveLength(0);
  });

  it('snaps left edge to candidate right edge', () => {
    // Moving layer left edge at 103, candidate right edge at 100
    const other = makeRasterLayer('b', 50, 50, 50, 50); // right edge at 100
    const result = snapPositionToLayers(103, 50, 50, 50, [other], threshold);
    expect(result.x).toBe(100); // left snaps to 100
    expect(result.snapLinesX).toContain(100);
  });

  it('snaps right edge to candidate left edge', () => {
    // Moving layer right edge at 103 (x=53, w=50), candidate left edge at 100
    const other = makeRasterLayer('b', 100, 50, 50, 50);
    const result = snapPositionToLayers(53, 50, 50, 50, [other], threshold);
    // right edge = 53+50=103, candidate left = 100, diff=3 <= 5 → snap: x = 100 - 50 = 50
    expect(result.x).toBe(50);
    expect(result.snapLinesX).toContain(100);
  });

  it('snaps top edge to candidate bottom edge', () => {
    const other = makeRasterLayer('b', 0, 0, 50, 100); // bottom at 100
    const result = snapPositionToLayers(0, 103, 50, 50, [other], threshold);
    expect(result.y).toBe(100);
    expect(result.snapLinesY).toContain(100);
  });

  it('snaps center-x to candidate center-x', () => {
    // Moving layer: x=95, w=50 → centerX=120. Candidate: x=100, w=40 → centerX=120
    const other = makeRasterLayer('b', 100, 200, 40, 40); // centerX=120
    const result = snapPositionToLayers(95, 200, 50, 50, [other], threshold);
    expect(result.x).toBe(95); // centerX already == 120, no change needed
    expect(result.snapLinesX).toContain(120);
  });

  it('produces no snap lines when threshold is exactly exceeded', () => {
    const other = makeRasterLayer('b', 200, 200, 50, 50); // left=200
    // Moving: x=194, w=50 → left=194, dist=6 > threshold=5
    const result = snapPositionToLayers(194, 200, 50, 50, [other], threshold);
    expect(result.x).toBe(194);
    expect(result.snapLinesX).toHaveLength(0);
  });

  it('ignores invisible layers', () => {
    const other: Layer = { ...makeRasterLayer('b', 50, 50, 50, 50), visible: false };
    const result = snapPositionToLayers(53, 50, 50, 50, [other], threshold);
    expect(result.x).toBe(53);
    expect(result.snapLinesX).toHaveLength(0);
  });

  it('returns correct snap lines for both axes simultaneously', () => {
    const other = makeRasterLayer('b', 100, 100, 50, 50); // left=100, top=100
    // Moving: x=103, y=103, w=50, h=50 → left=103 near 100, top=103 near 100
    const result = snapPositionToLayers(103, 103, 50, 50, [other], threshold);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.snapLinesX).toContain(100);
    expect(result.snapLinesY).toContain(100);
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
