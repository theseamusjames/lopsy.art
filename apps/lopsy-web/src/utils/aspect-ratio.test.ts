import { describe, it, expect } from 'vitest';
import {
  ASPECT_RATIO_PRESETS,
  clampAspectRatioTerm,
  documentAspectRatio,
  findAspectRatioPreset,
  parseAspectRatioDraft,
} from './aspect-ratio';

describe('aspect ratio terms', () => {
  it('never go below 1', () => {
    expect(clampAspectRatioTerm(0)).toBe(1);
    expect(clampAspectRatioTerm(0.1)).toBe(1);
    expect(clampAspectRatioTerm(-5)).toBe(1);
    expect(clampAspectRatioTerm(Number.NaN)).toBe(1);
  });

  it('keep decimals at or above 1', () => {
    expect(clampAspectRatioTerm(1.85)).toBe(1.85);
    expect(clampAspectRatioTerm(7)).toBe(7);
  });
});

describe('parseAspectRatioDraft', () => {
  it('returns null for an empty or non-numeric draft so the field reverts', () => {
    expect(parseAspectRatioDraft('')).toBeNull();
    expect(parseAspectRatioDraft('   ')).toBeNull();
    expect(parseAspectRatioDraft('abc')).toBeNull();
  });

  it('commits typed numbers, clamped to the minimum', () => {
    expect(parseAspectRatioDraft('5')).toBe(5);
    expect(parseAspectRatioDraft(' 7 ')).toBe(7);
    expect(parseAspectRatioDraft('0')).toBe(1);
    expect(parseAspectRatioDraft('2.35')).toBe(2.35);
  });
});

describe('findAspectRatioPreset', () => {
  it('matches a preset by its exact terms', () => {
    expect(findAspectRatioPreset(16, 9)?.id).toBe('16:9');
    expect(findAspectRatioPreset(5, 7)?.id).toBe('5:7');
  });

  it('returns undefined for a custom ratio', () => {
    expect(findAspectRatioPreset(32, 9)).toBeUndefined();
  });

  it('has unique preset ids', () => {
    const ids = ASPECT_RATIO_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('documentAspectRatio', () => {
  it('reduces the document size to lowest terms', () => {
    expect(documentAspectRatio(800, 600)).toEqual({ w: 4, h: 3 });
    expect(documentAspectRatio(1920, 1080)).toEqual({ w: 16, h: 9 });
    expect(documentAspectRatio(1000, 1000)).toEqual({ w: 1, h: 1 });
    expect(documentAspectRatio(1921, 1081)).toEqual({ w: 1921, h: 1081 });
  });

  it('keeps portrait orientation', () => {
    expect(documentAspectRatio(1080, 1920)).toEqual({ w: 9, h: 16 });
  });

  it('scales terms that are still too large into range', () => {
    const r = documentAspectRatio(20001, 10000);
    expect(r.w).toBeLessThanOrEqual(10000);
    expect(r.w / r.h).toBeCloseTo(20001 / 10000, 3);
  });
});
