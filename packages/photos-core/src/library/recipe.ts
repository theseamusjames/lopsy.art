/**
 * A recipe: the parameters of one non-destructive edit. The engine renders
 * a recipe; the library stores it as one last-writer-wins field per leaf
 * (`recipe.tone.exposure`), so edits to different sliders made on two
 * devices both survive a merge (spec 6.6).
 *
 * POC scope: the controls the engine can render today plus white balance,
 * curves, colour by hue and colour grading. The full set (areas, spots...)
 * is in spec 5.4. Curves are one JSON-array leaf per channel, so a curve
 * merges as a whole; every other control is one numeric leaf.
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

/** A tone-curve point, as Lopsy's Curves adjustment has it (input and output in 0..1). */
export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

export type CurveChannel = 'luminance' | 'red' | 'green' | 'blue';
export const CURVE_CHANNELS: readonly CurveChannel[] = ['luminance', 'red', 'green', 'blue'];

export type HueBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export const HUE_BANDS: readonly HueBand[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

export interface HueAdjustment {
  /** -100..100 each. */
  readonly hue: number;
  readonly saturation: number;
  readonly luminance: number;
}

/** One colour-grading wheel, as Lopsy's ColorGradeWheel. */
export interface GradeWheel {
  /** Degrees, 0..360. */
  readonly hue: number;
  /** Tint strength, 0..100. */
  readonly saturation: number;
  /** -100..100. */
  readonly luminance: number;
}

export type GradeRange = 'shadows' | 'midtones' | 'highlights' | 'global';
export const GRADE_RANGES: readonly GradeRange[] = ['shadows', 'midtones', 'highlights', 'global'];

export interface ColorGrading {
  readonly shadows: GradeWheel;
  readonly midtones: GradeWheel;
  readonly highlights: GradeWheel;
  readonly global: GradeWheel;
  /** Overlap between the tonal ranges, 0..100 (Lopsy's default 50). */
  readonly blending: number;
  /** Shifts the ranges toward shadows or highlights, -100..100. */
  readonly balance: number;
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
  /** One curve per channel; the identity is [{0,0},{1,1}]. */
  readonly curves: Readonly<Record<CurveChannel, readonly CurvePoint[]>>;
  readonly colorByHue: Readonly<Record<HueBand, HueAdjustment>>;
  readonly colorGrading: ColorGrading;
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
  ...Object.fromEntries(
    HUE_BANDS.flatMap((band) =>
      (['hue', 'saturation', 'luminance'] as const).map((field) => [
        `colorByHue.${band}.${field}`,
        { min: -100, max: 100, step: 1 },
      ]),
    ),
  ),
  ...Object.fromEntries(
    GRADE_RANGES.flatMap((range) => [
      [`colorGrading.${range}.hue`, { min: 0, max: 360, step: 1 }],
      [`colorGrading.${range}.saturation`, { min: 0, max: 100, step: 1 }],
      [`colorGrading.${range}.luminance`, { min: -100, max: 100, step: 1 }],
    ]),
  ),
  'colorGrading.blending': { min: 0, max: 100, step: 1 },
  'colorGrading.balance': { min: -100, max: 100, step: 1 },
};

export const IDENTITY_CURVE: readonly CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const NEUTRAL_HUE: HueAdjustment = { hue: 0, saturation: 0, luminance: 0 };
const NEUTRAL_WHEEL: GradeWheel = { hue: 0, saturation: 0, luminance: 0 };
/** Lopsy's DEFAULT_GRADE_BLENDING. */
const DEFAULT_BLENDING = 50;

export const DEFAULT_RECIPE: Recipe = {
  pipeline: PIPELINE_VERSION,
  profile: { id: 'standard' },
  whiteBalance: { mode: 'asShot', temperature: 0, tint: 0 },
  tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
  color: { vibrance: 0, saturation: 0 },
  finish: { vignette: 0 },
  framing: { rotate: 0, flipH: false, crop: null },
  curves: { luminance: IDENTITY_CURVE, red: IDENTITY_CURVE, green: IDENTITY_CURVE, blue: IDENTITY_CURVE },
  colorByHue: {
    red: NEUTRAL_HUE,
    orange: NEUTRAL_HUE,
    yellow: NEUTRAL_HUE,
    green: NEUTRAL_HUE,
    aqua: NEUTRAL_HUE,
    blue: NEUTRAL_HUE,
    purple: NEUTRAL_HUE,
    magenta: NEUTRAL_HUE,
  },
  colorGrading: {
    shadows: NEUTRAL_WHEEL,
    midtones: NEUTRAL_WHEEL,
    highlights: NEUTRAL_WHEEL,
    global: NEUTRAL_WHEEL,
    blending: DEFAULT_BLENDING,
    balance: 0,
  },
};

export type RecipeLeaf = number | string | boolean | CropRect | readonly CurvePoint[] | null;

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
  for (const channel of CURVE_CHANNELS) out[`curves.${channel}`] = recipe.curves[channel];
  for (const band of HUE_BANDS) {
    const h = recipe.colorByHue[band];
    out[`colorByHue.${band}.hue`] = h.hue;
    out[`colorByHue.${band}.saturation`] = h.saturation;
    out[`colorByHue.${band}.luminance`] = h.luminance;
  }
  for (const range of GRADE_RANGES) {
    const w = recipe.colorGrading[range];
    out[`colorGrading.${range}.hue`] = w.hue;
    out[`colorGrading.${range}.saturation`] = w.saturation;
    out[`colorGrading.${range}.luminance`] = w.luminance;
  }
  out['colorGrading.blending'] = recipe.colorGrading.blending;
  out['colorGrading.balance'] = recipe.colorGrading.balance;
  return out;
}

function clamp(path: string, value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const range = RECIPE_RANGES[path];
  if (!range) return value;
  return Math.min(range.max, Math.max(range.min, value));
}

/** The smallest crop side, as a fraction of the image. */
export const MIN_CROP_SIZE = 0.01;

/** A crop inside the image (0..1 on both axes) with sides of at least MIN_CROP_SIZE. */
function isCropRect(value: unknown): value is CropRect {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!['x', 'y', 'width', 'height'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k] as number))) {
    return false;
  }
  const { x, y, width, height } = v as unknown as CropRect;
  // A tiny tolerance absorbs rounding in x + width.
  const edge = 1 + 1e-9;
  return x >= 0 && y >= 0 && width >= MIN_CROP_SIZE && height >= MIN_CROP_SIZE && x + width <= edge && y + height <= edge;
}

export const MAX_CURVE_POINTS = 16;

/**
 * A curve of 2 to 16 points, x strictly increasing from 0 to 1, y in 0..1;
 * anything else is the identity. Points are copied, so the recipe never
 * shares objects with stored data.
 */
function curveFrom(value: unknown): readonly CurvePoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_CURVE_POINTS) return IDENTITY_CURVE;
  const points: CurvePoint[] = [];
  for (const p of value as unknown[]) {
    if (typeof p !== 'object' || p === null) return IDENTITY_CURVE;
    const { x, y } = p as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return IDENTITY_CURVE;
    if (x < 0 || x > 1 || y < 0 || y > 1) return IDENTITY_CURVE;
    const prev = points[points.length - 1];
    if (prev && x <= prev.x) return IDENTITY_CURVE;
    points.push({ x, y });
  }
  if (points[0]?.x !== 0 || points[points.length - 1]?.x !== 1) return IDENTITY_CURVE;
  return isIdentityCurve(points) ? IDENTITY_CURVE : points;
}

function isIdentityCurve(points: readonly CurvePoint[]): boolean {
  return points.length === 2 && points[0]?.y === 0 && points[1]?.y === 1;
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
  const wheel = (range: GradeRange): GradeWheel => ({
    hue: num(`colorGrading.${range}.hue`, 0),
    saturation: num(`colorGrading.${range}.saturation`, 0),
    luminance: num(`colorGrading.${range}.luminance`, 0),
  });
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
    curves: {
      luminance: curveFrom(paths['curves.luminance']),
      red: curveFrom(paths['curves.red']),
      green: curveFrom(paths['curves.green']),
      blue: curveFrom(paths['curves.blue']),
    },
    colorByHue: Object.fromEntries(
      HUE_BANDS.map((band) => [
        band,
        {
          hue: num(`colorByHue.${band}.hue`, 0),
          saturation: num(`colorByHue.${band}.saturation`, 0),
          luminance: num(`colorByHue.${band}.luminance`, 0),
        },
      ]),
    ) as Record<HueBand, HueAdjustment>,
    colorGrading: {
      shadows: wheel('shadows'),
      midtones: wheel('midtones'),
      highlights: wheel('highlights'),
      global: wheel('global'),
      blending: num('colorGrading.blending', DEFAULT_BLENDING),
      balance: num('colorGrading.balance', 0),
    },
  };
}

const LATER_GROUPS = ['curves.', 'colorByHue.', 'colorGrading.'];

function isLaterPath(path: string): boolean {
  return LATER_GROUPS.some((g) => path.startsWith(g));
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
    // Controls added after the first release count only when set, so older recipes keep their hash.
    .filter((k) => !(isLaterPath(k) && JSON.stringify(paths[k]) === JSON.stringify(DEFAULT_PATHS[k])))
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

const DEFAULT_PATHS: Readonly<Record<string, RecipeLeaf>> = recipeToPaths(DEFAULT_RECIPE);
