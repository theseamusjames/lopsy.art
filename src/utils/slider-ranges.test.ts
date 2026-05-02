import { describe, it, expect } from 'vitest';
import { docScaledMax, docScaledOffset } from './slider-ranges';

describe('docScaledMax', () => {
  it('returns baseMax when doc is small', () => {
    expect(docScaledMax(100, 100, 200)).toBe(200);
  });

  it('scales with the larger dimension by 1.5x', () => {
    expect(docScaledMax(800, 600, 200)).toBe(1200);
    expect(docScaledMax(600, 800, 200)).toBe(1200);
  });

  it('caps at 5000', () => {
    expect(docScaledMax(10000, 10000, 200)).toBe(5000);
    expect(docScaledMax(4000, 4000, 200)).toBe(5000);
  });

  it('honours brush-size example: 1.5x max(w,h) or 5000', () => {
    expect(docScaledMax(2000, 1000, 200)).toBe(3000);
    expect(docScaledMax(4000, 2000, 200)).toBe(5000);
  });

  it('never returns less than baseMax', () => {
    expect(docScaledMax(50, 50, 100)).toBe(100);
  });
});

describe('docScaledOffset', () => {
  it('returns baseAbs when doc is small', () => {
    expect(docScaledOffset(50, 50, 100)).toBe(100);
  });

  it('scales with the larger dimension', () => {
    expect(docScaledOffset(2000, 1000, 100)).toBe(3000);
  });

  it('caps at 5000', () => {
    expect(docScaledOffset(10000, 10000, 100)).toBe(5000);
  });
});
