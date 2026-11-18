import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, type QuarterTurns, type Recipe } from '@lopsy/photos-core/library/recipe';
import {
  NO_PHOTO_FILTER,
  effectiveFraming,
  framingAngle,
  framedSize,
  framingOps,
  recipeToAdjustments,
  sameAdjustments,
  whiteBalanceFilter,
  type Framing,
  type FramingOp,
} from './recipe-to-adjustments';

function withTone(patch: Partial<Recipe['tone']>): Recipe {
  return { ...DEFAULT_RECIPE, tone: { ...DEFAULT_RECIPE.tone, ...patch } };
}

describe('recipeToAdjustments', () => {
  it('maps the default recipe to no change', () => {
    const adj = recipeToAdjustments(DEFAULT_RECIPE);
    expect(adj).toEqual({
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      saturation: 0,
      vibrance: 0,
      vignette: 0,
      photoFilter: NO_PHOTO_FILTER,
    });
  });

  it('passes tone, colour and finish values through in the engine units', () => {
    const recipe: Recipe = {
      ...withTone({ exposure: 0.3, contrast: 20, highlights: -40, shadows: 35, whites: 10, blacks: -5 }),
      color: { vibrance: 15, saturation: -25 },
      finish: { vignette: 30 },
    };
    const adj = recipeToAdjustments(recipe);
    expect(adj.exposure).toBe(0.3);
    expect(adj.contrast).toBe(20);
    expect(adj.highlights).toBe(-40);
    expect(adj.shadows).toBe(35);
    expect(adj.whites).toBe(10);
    expect(adj.blacks).toBe(-5);
    expect(adj.vibrance).toBe(15);
    expect(adj.saturation).toBe(-25);
    expect(adj.vignette).toBe(30);
  });

  it('turns white balance into a photo filter', () => {
    const recipe: Recipe = { ...DEFAULT_RECIPE, whiteBalance: { mode: 'custom', temperature: 50, tint: 0 } };
    const pf = recipeToAdjustments(recipe).photoFilter;
    expect(pf.density).toBe(1);
    expect(pf.r).toBe(1);
    expect(pf.b).toBeLessThan(pf.g);
    expect(pf.g).toBeLessThan(pf.r);
  });
});

describe('recipeToAdjustments for RAW', () => {
  it('leaves exposure and white balance to the develop stage', () => {
    const recipe: Recipe = {
      ...withTone({ exposure: 1, contrast: 30 }),
      whiteBalance: { mode: 'custom', temperature: 50, tint: 10 },
    };
    const adj = recipeToAdjustments(recipe, { isRaw: true });
    expect(adj.exposure).toBe(0);
    expect(adj.photoFilter).toBe(NO_PHOTO_FILTER);
    expect(adj.contrast).toBe(30);
  });
});

describe('whiteBalanceFilter', () => {
  it('is off at zero', () => {
    expect(whiteBalanceFilter(0, 0)).toBe(NO_PHOTO_FILTER);
  });

  it('cools by raising blue over red', () => {
    const pf = whiteBalanceFilter(-100, 0);
    expect(pf.b).toBe(1);
    expect(pf.r).toBeCloseTo(0.5, 5);
  });

  it('moves green for tint: magenta lowers it, green raises it', () => {
    const magenta = whiteBalanceFilter(0, 100);
    expect(magenta.g).toBeLessThan(1);
    expect(magenta.r).toBe(1);
    const green = whiteBalanceFilter(0, -100);
    expect(green.g).toBe(1);
    expect(green.r).toBeLessThan(1);
    expect(green.r).toBeCloseTo(green.b, 10);
  });

  it('keeps every gain in 0..1', () => {
    for (const t of [-100, -30, 0, 45, 100]) {
      for (const m of [-100, 0, 70]) {
        const pf = whiteBalanceFilter(t, m);
        for (const v of [pf.r, pf.g, pf.b]) {
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('sameAdjustments', () => {
  it('compares every field', () => {
    const a = recipeToAdjustments(DEFAULT_RECIPE);
    expect(sameAdjustments(a, recipeToAdjustments(DEFAULT_RECIPE))).toBe(true);
    expect(sameAdjustments(a, recipeToAdjustments(withTone({ blacks: 1 })))).toBe(false);
    const wb: Recipe = { ...DEFAULT_RECIPE, whiteBalance: { mode: 'custom', temperature: 0, tint: 3 } };
    expect(sameAdjustments(a, recipeToAdjustments(wb))).toBe(false);
  });
});

/** Where the image's top-left, top-right and bottom-left corners end up, as labels on a 2x2 grid. */
type Grid = readonly [string, string, string, string];
const START: Grid = ['a', 'b', 'c', 'd'];

function apply(grid: Grid, op: FramingOp): Grid {
  const [a, b, c, d] = grid;
  if (op.kind === 'flipH') return [b, a, d, c];
  return op.clockwise ? [c, a, d, b] : [b, d, a, c];
}

function frame(framing: Framing): Grid {
  const ops: FramingOp[] = [];
  for (let i = 0; i < framing.rotate / 90; i++) ops.push({ kind: 'rotate', clockwise: true });
  if (framing.flipH) ops.push({ kind: 'flipH' });
  return ops.reduce(apply, START);
}

const ALL: Framing[] = ([0, 90, 180, 270] as QuarterTurns[]).flatMap((rotate) => [
  { rotate, flipH: false },
  { rotate, flipH: true },
]);

describe('framingOps', () => {
  it('takes every framing to every other', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const result = framingOps(from, to).reduce(apply, frame(from));
        expect(result).toEqual(frame(to));
      }
    }
  });

  it('does nothing when the framing is unchanged', () => {
    for (const f of ALL) expect(framingOps(f, f)).toEqual([]);
  });

  it('rotates a quarter turn back with one anticlockwise step', () => {
    expect(framingOps({ rotate: 90, flipH: false }, { rotate: 0, flipH: false })).toEqual([
      { kind: 'rotate', clockwise: false },
    ]);
  });
});

describe('framedSize', () => {
  it('swaps the sides on a quarter turn', () => {
    expect(framedSize(300, 200, 90)).toEqual({ width: 200, height: 300 });
    expect(framedSize(300, 200, 180)).toEqual({ width: 300, height: 200 });
  });
});

describe('effectiveFraming', () => {
  const base = DEFAULT_RECIPE.framing;

  it('folds a vertical flip into a half turn and a horizontal flip', () => {
    expect(effectiveFraming({ ...base, rotate: 90, flipV: true } as Recipe['framing'])).toEqual({ rotate: 270, flipH: true });
    expect(effectiveFraming({ ...base, flipH: true, flipV: true } as Recipe['framing'])).toEqual({ rotate: 180, flipH: false });
    expect(effectiveFraming(base)).toEqual({ rotate: 0, flipH: false });
  });

  it('a vertical flip mirrors top to bottom', () => {
    const f = effectiveFraming({ ...base, flipV: true } as Recipe['framing']);
    const ops: FramingOp[] = [];
    for (let i = 0; i < f.rotate / 90; i++) ops.push({ kind: 'rotate', clockwise: true });
    if (f.flipH) ops.push({ kind: 'flipH' });
    expect(ops.reduce(apply, START)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('reads the straighten angle, clamped, and 0 without one', () => {
    expect(framingAngle(base)).toBe(0);
    expect(framingAngle({ ...base, angle: 12.5 } as Recipe['framing'])).toBe(12.5);
    expect(framingAngle({ ...base, angle: 80 } as Recipe['framing'])).toBe(45);
  });
});
