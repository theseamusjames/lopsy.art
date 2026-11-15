import { describe, it, expect } from 'vitest';
import { extractSelectionPattern } from './pattern-extract';

const DOC_W = 100;
const DOC_H = 80;

function solidTexture(width: number, height: number): number[] {
  const px: number[] = [];
  for (let i = 0; i < width * height; i++) px.push(255, 0, 0, 255);
  return px;
}

function fullMask(): Uint8Array {
  return new Uint8Array(DOC_W * DOC_H).fill(255);
}

function selectionAt(x: number, y: number, width: number, height: number) {
  return { bounds: { x, y, width, height }, mask: fullMask(), maskWidth: DOC_W, maskHeight: DOC_H };
}

describe('extractSelectionPattern (#1142)', () => {
  const texture = { pixels: solidTexture(6, 6), x: 30, y: 10, width: 6, height: 6 };

  it('reads a moved layer at its document position', () => {
    const result = extractSelectionPattern(texture, selectionAt(30, 10, 6, 6), DOC_W, DOC_H)!;
    expect(result.width).toBe(6);
    expect(result.height).toBe(6);
    expect(Array.from(result.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(result.data[(6 * 6 - 1) * 4 + 3]).toBe(255);
  });

  it('gives transparent pixels where the layer has no texture', () => {
    const result = extractSelectionPattern(texture, selectionAt(1, 1, 4, 4), DOC_W, DOC_H)!;
    expect(result.width).toBe(4);
    expect(result.data.every((v) => v === 0)).toBe(true);
  });

  it('keeps the texture offset when the selection straddles the layer edge', () => {
    const result = extractSelectionPattern(texture, selectionAt(28, 10, 4, 1), DOC_W, DOC_H)!;
    const alphas = [3, 7, 11, 15].map((i) => result.data[i]);
    expect(alphas).toEqual([0, 0, 255, 255]);
  });

  it('returns null for a selection fully outside the document', () => {
    expect(extractSelectionPattern(texture, selectionAt(120, 0, 5, 5), DOC_W, DOC_H)).toBeNull();
  });
});
