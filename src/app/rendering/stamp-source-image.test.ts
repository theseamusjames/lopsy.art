import { describe, it, expect } from 'vitest';
import { stampSourceImageRect } from './stamp-source-image';

describe('stampSourceImageRect (#1146)', () => {
  it('maps a doc-space disc onto a layer texture offset in the document', () => {
    const source = { docRect: { x: 100, y: 50, width: 200, height: 100 }, imageWidth: 200, imageHeight: 100 };
    expect(stampSourceImageRect(source, { x: 150, y: 80 }, 10)).toEqual({ x: 40, y: 20, width: 20, height: 20 });
  });

  it('scales into a downsampled image', () => {
    const source = { docRect: { x: 0, y: 0, width: 4000, height: 2000 }, imageWidth: 2000, imageHeight: 1000 };
    expect(stampSourceImageRect(source, { x: 1000, y: 500 }, 40)).toEqual({ x: 480, y: 230, width: 40, height: 40 });
  });
});
