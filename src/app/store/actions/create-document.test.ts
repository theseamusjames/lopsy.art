// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeCreateDocument } from './create-document';

describe('computeCreateDocument', () => {
  it('returns a document with correct dimensions', () => {
    const result = computeCreateDocument(800, 600, false);
    expect(result.document?.width).toBe(800);
    expect(result.document?.height).toBe(600);
    expect(result.document?.layers).toHaveLength(3); // bg + draw layer + root group
    expect(result.document?.layerOrder).toHaveLength(3);
    expect(result.document?.activeLayerId).toBe(result.document?.layers[1]?.id);
    expect(result.document?.rootGroupId).toBeTruthy();
  });

  it('creates white-filled pixel data for non-transparent background', () => {
    const result = computeCreateDocument(2, 2, false);
    const layerId = result.document!.layers[0]!.id;
    const imgData = result.layerPixelData!.get(layerId)!;
    expect(imgData.width).toBe(2);
    expect(imgData.height).toBe(2);
    for (let i = 0; i < imgData.data.length; i += 4) {
      expect(imgData.data[i]).toBe(255);
      expect(imgData.data[i + 1]).toBe(255);
      expect(imgData.data[i + 2]).toBe(255);
      expect(imgData.data[i + 3]).toBe(255);
    }
    expect(result.document!.backgroundColor).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('creates empty pixel data for transparent background', () => {
    const result = computeCreateDocument(2, 2, true);
    const layerId = result.document!.layers[0]!.id;
    const imgData = result.layerPixelData!.get(layerId)!;
    for (let i = 0; i < imgData.data.length; i++) {
      expect(imgData.data[i]).toBe(0);
    }
    expect(result.document!.backgroundColor).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('resets undoStack, redoStack, and selection', () => {
    const result = computeCreateDocument(100, 100, false);
    expect(result.undoStack).toEqual([]);
    expect(result.redoStack).toEqual([]);
    expect(result.selection).toEqual({ active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 });
  });
});

describe('computeCreateDocument — non-RGB modes', () => {
  /** First pixel of the background layer. */
  function firstPixel(result: ReturnType<typeof computeCreateDocument>): number[] {
    const layerId = result.document!.layers[0]!.id;
    const data = result.layerPixelData!.get(layerId)!.data;
    return [data[0]!, data[1]!, data[2]!, data[3]!];
  }

  it('writes a white canvas as neutral bytes in grayscale', () => {
    expect(firstPixel(computeCreateDocument(2, 2, false, 'grayscale'))).toEqual([255, 255, 255, 255]);
  });

  it('encodes a white canvas as Lab L=100 with neutral chroma', () => {
    // Left as literal white, the a/b bytes would read as maximum chroma and
    // the canvas would open a saturated orange-red.
    expect(firstPixel(computeCreateDocument(2, 2, false, 'lab'))).toEqual([255, 128, 128, 255]);
  });

  it('keeps transparent Lab pixels on the neutral axis', () => {
    expect(firstPixel(computeCreateDocument(2, 2, true, 'lab'))).toEqual([0, 128, 128, 0]);
  });

  it('leaves a CMYK canvas as plain white — the mode is sRGB-backed', () => {
    expect(firstPixel(computeCreateDocument(2, 2, false, 'cmyk'))).toEqual([255, 255, 255, 255]);
  });

  it('creates a single flat surface for modes that cannot hold layers', () => {
    const layers = computeCreateDocument(2, 2, false, 'indexed').document!.layers;
    // Background + root group only — no second draw layer.
    expect(layers.filter((l) => l.type !== 'group')).toHaveLength(1);
  });

  it('still gives layered modes a draw layer above the background', () => {
    for (const mode of ['rgb', 'grayscale', 'lab', 'cmyk'] as const) {
      const layers = computeCreateDocument(2, 2, false, mode).document!.layers;
      expect(layers.filter((l) => l.type !== 'group')).toHaveLength(2);
    }
  });

  it('omits chroma adjustments a non-RGB document is not allowed to have', () => {
    for (const mode of ['grayscale', 'lab', 'cmyk'] as const) {
      const doc = computeCreateDocument(2, 2, false, mode).document!;
      const root = doc.layers.find((l) => l.type === 'group');
      expect(root?.type).toBe('group');
      const types = root?.type === 'group' ? root.adjustments.map((n) => n.type) : [];
      expect(types).not.toContain('hue-saturation');
    }
  });
});
