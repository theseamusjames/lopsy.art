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
