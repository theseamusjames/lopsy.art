import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, HUE_BANDS, isDefaultRecipe, RECIPE_RANGES, recipeFromPaths, recipeHash, recipeToPaths } from './recipe';

describe('recipeFromPaths', () => {
  it('gives the default recipe for no paths', () => {
    expect(recipeFromPaths({})).toEqual(DEFAULT_RECIPE);
  });

  it('round trips through recipeToPaths', () => {
    const recipe = recipeFromPaths({
      'tone.exposure': 1.25,
      'color.vibrance': 30,
      'whiteBalance.mode': 'custom',
      'framing.rotate': 90,
      'framing.flipH': true,
      'framing.crop': { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
    });
    expect(recipeFromPaths(recipeToPaths(recipe))).toEqual(recipe);
  });

  it('clamps numbers to their ranges', () => {
    const recipe = recipeFromPaths({ 'tone.exposure': 12, 'tone.contrast': -500, 'whiteBalance.tint': 40 });
    expect(recipe.tone.exposure).toBe(5);
    expect(recipe.tone.contrast).toBe(-100);
    expect(recipe.whiteBalance.tint).toBe(40);
  });

  it('falls back to defaults for invalid values', () => {
    const recipe = recipeFromPaths({
      'tone.exposure': 'bright',
      'tone.shadows': Number.NaN,
      'tone.whites': Infinity,
      'framing.rotate': 45,
      'framing.flipH': 'yes',
      'framing.crop': { x: 0, y: 0, width: 'wide', height: 1 },
      'whiteBalance.mode': 'auto',
      pipeline: 0,
      'profile.id': '',
    });
    expect(recipe).toEqual(DEFAULT_RECIPE);
  });

  it('ignores unknown paths so recipes from newer apps open', () => {
    const recipe = recipeFromPaths({ 'tone.exposure': 0.5, 'curves.luminance': [[0, 0]], 'areas.x.mask': {} });
    expect(recipe.tone.exposure).toBe(0.5);
    expect(Object.keys(recipe)).toEqual(Object.keys(DEFAULT_RECIPE));
  });
});

describe('recipeHash', () => {
  it('is stable and independent of key order', () => {
    const a = recipeFromPaths({ 'tone.exposure': 1, 'color.saturation': -20 });
    const b = recipeFromPaths({ 'color.saturation': -20, 'tone.exposure': 1 });
    expect(recipeHash(a)).toBe(recipeHash(b));
    expect(recipeHash(a)).toMatch(/^[0-9a-f]{16}$/);
    // Pinned so a change to the hash (which invalidates every stored preview) is deliberate.
    expect(recipeHash(DEFAULT_RECIPE)).toBe('7f20cac1cb53c8fd');
  });

  it('changes when any leaf changes', () => {
    const base = recipeHash(DEFAULT_RECIPE);
    expect(recipeHash(recipeFromPaths({ 'tone.exposure': 0.01 }))).not.toBe(base);
    expect(recipeHash(recipeFromPaths({ 'framing.flipH': true }))).not.toBe(base);
    expect(recipeHash(recipeFromPaths({ 'framing.crop': { x: 0, y: 0, width: 1, height: 1 } }))).not.toBe(base);
  });

  it('isDefaultRecipe tells edited from unedited', () => {
    expect(isDefaultRecipe(DEFAULT_RECIPE)).toBe(true);
    expect(isDefaultRecipe(recipeFromPaths({ 'finish.vignette': -10 }))).toBe(false);
  });
});

describe('crop validation', () => {
  it('keeps crops inside the image with a minimum size', () => {
    const ok = { x: 0.1, y: 0.2, width: 0.5, height: 0.8 };
    expect(recipeFromPaths({ 'framing.crop': ok }).framing.crop).toEqual(ok);
    expect(recipeFromPaths({ 'framing.crop': { x: 0, y: 0, width: 1, height: 1 } }).framing.crop).not.toBeNull();
    for (const bad of [
      { x: -0.1, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: -0.01, width: 0.5, height: 0.5 },
      { x: 0.6, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.6 },
      { x: 0, y: 0, width: 0, height: 0.5 },
      { x: 0, y: 0, width: 0.5, height: 0.001 },
      { x: 0, y: 0, width: -0.5, height: 0.5 },
    ]) {
      expect(recipeFromPaths({ 'framing.crop': bad }).framing.crop).toBeNull();
    }
  });
});

describe('curves, colour by hue and colour grading', () => {
  it('have neutral defaults matching Lopsy', () => {
    expect(DEFAULT_RECIPE.curves.luminance).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(Object.keys(DEFAULT_RECIPE.colorByHue)).toEqual([...HUE_BANDS]);
    expect(DEFAULT_RECIPE.colorByHue.aqua).toEqual({ hue: 0, saturation: 0, luminance: 0 });
    expect(DEFAULT_RECIPE.colorGrading).toMatchObject({ blending: 50, balance: 0, global: { hue: 0, saturation: 0, luminance: 0 } });
    expect(recipeToPaths(DEFAULT_RECIPE)['colorByHue.magenta.luminance']).toBe(0);
    expect(RECIPE_RANGES['colorGrading.shadows.hue']).toEqual({ min: 0, max: 360, step: 1 });
  });

  it('round trip and clamp', () => {
    const curve = [
      { x: 0, y: 0.05 },
      { x: 0.5, y: 0.6 },
      { x: 1, y: 0.95 },
    ];
    const recipe = recipeFromPaths({
      'curves.red': curve,
      'colorByHue.orange.saturation': -40,
      'colorByHue.blue.hue': 500,
      'colorGrading.shadows.hue': 400,
      'colorGrading.shadows.saturation': -5,
      'colorGrading.highlights.luminance': 30,
      'colorGrading.blending': 80,
      'colorGrading.balance': -200,
    });
    expect(recipe.curves.red).toEqual(curve);
    expect(recipe.colorByHue.orange.saturation).toBe(-40);
    expect(recipe.colorByHue.blue.hue).toBe(100);
    expect(recipe.colorGrading.shadows).toEqual({ hue: 360, saturation: 0, luminance: 0 });
    expect(recipe.colorGrading.highlights.luminance).toBe(30);
    expect(recipe.colorGrading.blending).toBe(80);
    expect(recipe.colorGrading.balance).toBe(-100);
    expect(recipeFromPaths(JSON.parse(JSON.stringify(recipeToPaths(recipe))))).toEqual(recipe);
    expect(isDefaultRecipe(recipe)).toBe(false);
  });

  it('turn invalid curves into the identity', () => {
    const identity = DEFAULT_RECIPE.curves.luminance;
    for (const bad of [
      null,
      'curve',
      [{ x: 0, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0.9, y: 1 }],
      [{ x: 0.1, y: 0 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0.7, y: 0.5 }, { x: 0.3, y: 0.6 }, { x: 1, y: 1 }],
      [{ x: 0, y: -0.1 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1.5 }],
      [{ x: 0, y: 0 }, { x: 0.5, y: NaN }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, 'p', { x: 1, y: 1 }],
      Array.from({ length: 17 }, (_, i) => ({ x: i / 16, y: i / 16 })),
    ]) {
      expect(recipeFromPaths({ 'curves.luminance': bad }).curves.luminance).toEqual(identity);
    }
  });

  it('keep older recipes’ hashes, and change the hash when a curve point moves', () => {
    expect(recipeHash(DEFAULT_RECIPE)).toBe('7f20cac1cb53c8fd');
    const a = recipeFromPaths({ 'curves.luminance': [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] });
    const b = recipeFromPaths({ 'curves.luminance': [{ x: 0, y: 0 }, { x: 0.5, y: 0.61 }, { x: 1, y: 1 }] });
    expect(recipeHash(a)).not.toBe(recipeHash(DEFAULT_RECIPE));
    expect(recipeHash(a)).not.toBe(recipeHash(b));
    expect(recipeHash(recipeFromPaths({ 'colorGrading.balance': 1 }))).not.toBe(recipeHash(DEFAULT_RECIPE));
    expect(recipeHash(recipeFromPaths({ 'colorByHue.red.hue': 1 }))).not.toBe(recipeHash(DEFAULT_RECIPE));
    expect(isDefaultRecipe(recipeFromPaths({ 'curves.blue': [{ x: 0, y: 0 }, { x: 1, y: 1 }] }))).toBe(true);
  });
});
