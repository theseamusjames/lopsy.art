import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GRADIENT_SETTINGS,
  MAX_GRADIENT_STOPS,
  MIN_GRADIENT_STOPS,
  appendGradientStop,
  clampGradientSetting,
  removeGradientStopAt,
  updateGradientStopAt,
  type GradientSettings,
} from './gradient-settings';

describe('gradient-settings clamps and defaults (#453)', () => {
  it('defaults match the values the flat-bag store carried', () => {
    expect(DEFAULT_GRADIENT_SETTINGS).toEqual({
      type: 'linear',
      stops: [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
      ],
      reverse: false,
    } satisfies GradientSettings);
  });

  describe('clampGradientSetting — type', () => {
    it('passes the valid enum values through untouched', () => {
      expect(clampGradientSetting('type', 'linear')).toBe('linear');
      expect(clampGradientSetting('type', 'radial')).toBe('radial');
    });

    it('collapses unknown strings to linear (same shape as the shape slice #623)', () => {
      // A typed-string @ts-ignore bypass — e.g. legacy code reaching for
      // 'conic' or an empty string — must not leave the GPU dispatch
      // staring at a stale enum. Collapse to the documented default.
      expect(clampGradientSetting('type', 'conic' as 'linear' | 'radial')).toBe('linear');
      expect(clampGradientSetting('type', '' as 'linear' | 'radial')).toBe('linear');
    });
  });

  describe('clampGradientSetting — reverse', () => {
    it('passes booleans through untouched', () => {
      expect(clampGradientSetting('reverse', true)).toBe(true);
      expect(clampGradientSetting('reverse', false)).toBe(false);
    });
  });

  describe('clampGradientSetting — stops', () => {
    it('passes a normal 2-stop list through untouched (already sorted, in range)', () => {
      const stops = [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
      ];
      expect(clampGradientSetting('stops', stops)).toEqual(stops);
    });

    it('pads a 0-stop list up to the minimum count', () => {
      const clamped = clampGradientSetting('stops', []);
      expect(clamped.length).toBe(MIN_GRADIENT_STOPS);
    });

    it('pads a 1-stop list up to the minimum count', () => {
      const clamped = clampGradientSetting('stops', [
        { position: 0.5, color: { r: 200, g: 100, b: 50, a: 1 } },
      ]);
      expect(clamped.length).toBe(MIN_GRADIENT_STOPS);
      // The original stop is preserved.
      expect(clamped.some((s) => s.color.r === 200)).toBe(true);
    });

    it('slices to the maximum count (the GPU dispatch uniform cap)', () => {
      const tooMany = Array.from({ length: MAX_GRADIENT_STOPS + 5 }, (_, i) => ({
        position: i / (MAX_GRADIENT_STOPS + 4),
        color: { r: i, g: 0, b: 0, a: 1 },
      }));
      const clamped = clampGradientSetting('stops', tooMany);
      expect(clamped.length).toBe(MAX_GRADIENT_STOPS);
    });

    it('clamps per-stop positions into [0, 1]', () => {
      const clamped = clampGradientSetting('stops', [
        { position: -0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1.5, color: { r: 255, g: 255, b: 255, a: 1 } },
      ]);
      expect(clamped[0]!.position).toBe(0);
      expect(clamped[1]!.position).toBe(1);
    });

    it('sorts by position so consumers can interval-walk without re-sorting', () => {
      const clamped = clampGradientSetting('stops', [
        { position: 0.8, color: { r: 0, g: 0, b: 255, a: 1 } },
        { position: 0.2, color: { r: 255, g: 0, b: 0, a: 1 } },
        { position: 0.5, color: { r: 0, g: 255, b: 0, a: 1 } },
      ]);
      expect(clamped.map((s) => s.position)).toEqual([0.2, 0.5, 0.8]);
    });
  });
});

describe('gradient stop operations (#453)', () => {
  const base = [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
  ];

  describe('appendGradientStop', () => {
    it('inserts a stop at the requested position and re-sorts', () => {
      const next = appendGradientStop(base, 0.5, { r: 128, g: 128, b: 128, a: 1 });
      expect(next.length).toBe(3);
      expect(next.map((s) => s.position)).toEqual([0, 0.5, 1]);
      expect(next[1]!.color.r).toBe(128);
    });

    it('clamps position into [0, 1]', () => {
      const aboveOne = appendGradientStop(base, 5, { r: 0, g: 0, b: 0, a: 1 });
      expect(aboveOne[aboveOne.length - 1]!.position).toBe(1);

      const belowZero = appendGradientStop(base, -5, { r: 0, g: 0, b: 0, a: 1 });
      expect(belowZero[0]!.position).toBe(0);
    });

    it('rejects when the list is already at the max', () => {
      const full = Array.from({ length: MAX_GRADIENT_STOPS }, (_, i) => ({
        position: i / (MAX_GRADIENT_STOPS - 1),
        color: { r: 0, g: 0, b: 0, a: 1 },
      }));
      const next = appendGradientStop(full, 0.5, { r: 255, g: 255, b: 255, a: 1 });
      expect(next).toBe(full);
    });
  });

  describe('removeGradientStopAt', () => {
    it('removes the stop at the requested index', () => {
      const threeStop = [
        ...base.slice(0, 1),
        { position: 0.5, color: { r: 128, g: 128, b: 128, a: 1 } },
        ...base.slice(1),
      ];
      const next = removeGradientStopAt(threeStop, 1);
      expect(next.length).toBe(2);
      expect(next.map((s) => s.position)).toEqual([0, 1]);
    });

    it('rejects when removing would drop the list below the minimum', () => {
      const next = removeGradientStopAt(base, 0);
      expect(next).toBe(base);
    });
  });

  describe('updateGradientStopAt', () => {
    it('patches position and color at the requested index', () => {
      const next = updateGradientStopAt(base, 1, {
        position: 0.75,
        color: { r: 200, g: 200, b: 200, a: 1 },
      });
      expect(next[1]!.position).toBe(0.75);
      expect(next[1]!.color.r).toBe(200);
    });

    it('preserves the existing field when partial omits it', () => {
      const next = updateGradientStopAt(base, 0, { position: 0.1 });
      expect(next[0]!.position).toBe(0.1);
      expect(next[0]!.color.r).toBe(0);
    });

    it('clamps patched position into [0, 1]', () => {
      const next = updateGradientStopAt(base, 1, { position: 2 });
      expect(next[next.length - 1]!.position).toBe(1);
    });

    it('re-sorts so moving a stop past its neighbour reorders rather than producing a flat band', () => {
      const threeStop = [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 0.5, color: { r: 128, g: 128, b: 128, a: 1 } },
        { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
      ];
      // Move the middle stop past the right end — the result must
      // still be monotonic. The clamp pulls 1.5 → 1, then the sort
      // reorders so the gradient interpolates correctly rather than
      // producing a flat band at the swap point.
      const next = updateGradientStopAt(threeStop, 1, { position: 1.5 });
      expect(next.map((s) => s.position)).toEqual([0, 1, 1]);
    });
  });
});
