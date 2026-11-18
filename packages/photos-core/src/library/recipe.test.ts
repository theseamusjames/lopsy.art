import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, isDefaultRecipe, recipeFromPaths, recipeHash, recipeToPaths } from './recipe';

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
