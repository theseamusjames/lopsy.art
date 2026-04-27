// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { describe, it, expect } from 'vitest';
import { computeOpenImage } from './open-image';

describe('computeOpenImage', () => {
  it('returns document sized to the image', () => {
    const imgData = new ImageData(320, 240);
    const result = computeOpenImage(imgData, 'photo.png');
    expect(result.document!.width).toBe(320);
    expect(result.document!.height).toBe(240);
  });

  it('sets the image data as layer pixel data', () => {
    const imgData = new ImageData(10, 10);
    imgData.data[0] = 42;
    const result = computeOpenImage(imgData, 'test.png');
    const layerId = result.document!.layers[0]!.id;
    const stored = result.layerPixelData!.get(layerId)!;
    expect(stored).toBe(imgData);
    expect(stored.data[0]).toBe(42);
  });

  it('sets document name', () => {
    const imgData = new ImageData(10, 10);
    const result = computeOpenImage(imgData, 'my-image.jpg');
    expect(result.document!.name).toBe('my-image.jpg');
  });

  it('sets transparent background when image has alpha < 255', () => {
    const imgData = new ImageData(2, 2);
    imgData.data[3] = 0; // first pixel fully transparent
    const result = computeOpenImage(imgData, 'transparent.png');
    expect(result.document!.backgroundColor).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('sets transparent background for opaque images too', () => {
    const imgData = new ImageData(2, 2);
    for (let i = 3; i < imgData.data.length; i += 4) {
      imgData.data[i] = 255;
    }
    const result = computeOpenImage(imgData, 'opaque.png');
    expect(result.document!.backgroundColor).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
