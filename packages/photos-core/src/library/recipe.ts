/**
 * A recipe: the parameters of one non-destructive edit. The engine renders
 * a recipe; the library stores it as one last-writer-wins field per leaf
 * (`recipe.tone.exposure`), so edits to different sliders made on two
 * devices both survive a merge (spec 6.6).
 *
 * POC scope: the controls the engine can render today plus white balance.
 * The full set (curves, colour by hue, areas, spots...) is in spec 5.4.
 */

/** Bumped when the rendering maths changes; old recipes keep their version. */
export const PIPELINE_VERSION = 1;

export type QuarterTurns = 0 | 90 | 180 | 270;

export interface CropRect {
  /** Normalized to the oriented source image, 0..1. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Recipe {
  readonly pipeline: number;
  readonly profile: { readonly id: string };
  readonly whiteBalance: {
    readonly mode: 'asShot' | 'custom';
    /** Relative shift, -100 (cooler) to 100 (warmer). Kelvin needs camera data (spec E9). */
    readonly temperature: number;
    /** Relative shift, -100 (greener) to 100 (more magenta). */
    readonly tint: number;
  };
  readonly tone: {
    /** EV stops. */
    readonly exposure: number;
    readonly contrast: number;
    readonly highlights: number;
    readonly shadows: number;
    readonly whites: number;
    readonly blacks: number;
  };
  readonly color: {
    readonly vibrance: number;
    readonly saturation: number;
  };
  readonly finish: {
    readonly vignette: number;
  };
  readonly framing: {
    readonly rotate: QuarterTurns;
    readonly flipH: boolean;
    readonly crop: CropRect | null;
  };
}

export interface RecipeRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Slider ranges for every numeric leaf, keyed by dotted path. */
export const RECIPE_RANGES: Readonly<Record<string, RecipeRange>> = {
  'whiteBalance.temperature': { min: -100, max: 100, step: 1 },
  'whiteBalance.tint': { min: -100, max: 100, step: 1 },
  'tone.exposure': { min: -5, max: 5, step: 0.01 },
  'tone.contrast': { min: -100, max: 100, step: 1 },
  'tone.highlights': { min: -100, max: 100, step: 1 },
  'tone.shadows': { min: -100, max: 100, step: 1 },
  'tone.whites': { min: -100, max: 100, step: 1 },
  'tone.blacks': { min: -100, max: 100, step: 1 },
  'color.vibrance': { min: -100, max: 100, step: 1 },
  'color.saturation': { min: -100, max: 100, step: 1 },
  'finish.vignette': { min: -100, max: 100, step: 1 },
};

export const DEFAULT_RECIPE: Recipe = {
  pipeline: PIPELINE_VERSION,
  profile: { id: 'standard' },
  whiteBalance: { mode: 'asShot', temperature: 0, tint: 0 },
  tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
  color: { vibrance: 0, saturation: 0 },
  finish: { vignette: 0 },
  framing: { rotate: 0, flipH: false, crop: null },
};

export type RecipeLeaf = number | string | boolean | CropRect | null;

/** The recipe flattened to dotted paths ('tone.exposure' -> 0.3). */
export function recipeToPaths(recipe: Recipe): Record<string, RecipeLeaf> {
  const out: Record<string, RecipeLeaf> = {};
  out['pipeline'] = recipe.pipeline;
  out['profile.id'] = recipe.profile.id;
  out['whiteBalance.mode'] = recipe.whiteBalance.mode;
  out['whiteBalance.temperature'] = recipe.whiteBalance.temperature;
  out['whiteBalance.tint'] = recipe.whiteBalance.tint;
  for (const [key, value] of Object.entries(recipe.tone)) out[`tone.${key}`] = value;
  for (const [key, value] of Object.entries(recipe.color)) out[`color.${key}`] = value;
  out['finish.vignette'] = recipe.finish.vignette;
  out['framing.rotate'] = recipe.framing.rotate;
  out['framing.flipH'] = recipe.framing.flipH;
  out['framing.crop'] = recipe.framing.crop;
  return out;
}

function clamp(path: string, value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const range = RECIPE_RANGES[path];
  if (!range) return value;
  return Math.min(range.max, Math.max(range.min, value));
}

function isCropRect(value: unknown): value is CropRect {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k] as number));
}

/**
 * Builds a recipe from dotted paths, falling back to defaults for missing
 * or invalid values and clamping numbers to their ranges. Unknown paths are
 * ignored, so a recipe written by a newer app still opens.
 */
export function recipeFromPaths(paths: Readonly<Record<string, unknown>>): Recipe {
  const d = DEFAULT_RECIPE;
  const num = (path: string, fallback: number) => clamp(path, paths[path], fallback);
  const rotate = paths['framing.rotate'];
  const mode = paths['whiteBalance.mode'];
  const pipeline = paths['pipeline'];
  const profile = paths['profile.id'];
  return {
    pipeline: typeof pipeline === 'number' && Number.isInteger(pipeline) && pipeline > 0 ? pipeline : d.pipeline,
    profile: { id: typeof profile === 'string' && profile !== '' ? profile : d.profile.id },
    whiteBalance: {
      mode: mode === 'custom' ? 'custom' : 'asShot',
      temperature: num('whiteBalance.temperature', d.whiteBalance.temperature),
      tint: num('whiteBalance.tint', d.whiteBalance.tint),
    },
    tone: {
      exposure: num('tone.exposure', d.tone.exposure),
      contrast: num('tone.contrast', d.tone.contrast),
      highlights: num('tone.highlights', d.tone.highlights),
      shadows: num('tone.shadows', d.tone.shadows),
      whites: num('tone.whites', d.tone.whites),
      blacks: num('tone.blacks', d.tone.blacks),
    },
    color: {
      vibrance: num('color.vibrance', d.color.vibrance),
      saturation: num('color.saturation', d.color.saturation),
    },
    finish: { vignette: num('finish.vignette', d.finish.vignette) },
    framing: {
      rotate: rotate === 90 || rotate === 180 || rotate === 270 ? rotate : 0,
      flipH: paths['framing.flipH'] === true,
      crop: isCropRect(paths['framing.crop']) ? paths['framing.crop'] : null,
    },
  };
}

/** Whether the recipe changes nothing (shows the badge-free tile). */
export function isDefaultRecipe(recipe: Recipe): boolean {
  return recipeHash(recipe) === recipeHash(DEFAULT_RECIPE);
}

/**
 * A short, stable hash of a recipe (FNV-1a over its sorted dotted paths),
 * used to tell whether a stored preview still matches the edit.
 */
export function recipeHash(recipe: Recipe): string {
  const paths = recipeToPaths(recipe);
  const text = Object.keys(paths)
    .sort()
    .map((k) => `${k}=${JSON.stringify(paths[k])}`)
    .join('\n');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
