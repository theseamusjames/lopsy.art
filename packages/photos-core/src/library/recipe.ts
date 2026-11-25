/**
 * A recipe: the parameters of one non-destructive edit. The engine renders
 * a recipe; the library stores it as one last-writer-wins field per leaf
 * (`recipe.tone.exposure`), so edits to different sliders made on two
 * devices both survive a merge (spec 6.6).
 *
 * Curves are one JSON-array leaf per channel and a crop or an area's
 * geometry one object leaf, so each merges as a whole; every other control
 * is one leaf. Areas are keyed by ID (`areas.<id>.…`) with a `deleted`
 * tombstone. Spot removal (spec 5.4) is not in the recipe yet.
 *
 * Controls added after the first release count in `recipeHash` only when
 * they differ from their default (`LATER_PATHS`, `LATER_GROUPS`), so a
 * recipe written before them keeps its hash and its stored previews.
 */

import type { Json } from './types';

/** Bumped when the rendering maths changes; old recipes keep their version. */
export const PIPELINE_VERSION = 1;

/**
 * What a recipe or a preview reads as when it records no pipeline: 1, the
 * only pipeline there was before versions and previews recorded theirs.
 */
export const UNRECORDED_PIPELINE = 1;

/** A recorded pipeline as a version number; anything else (missing, broken) is UNRECORDED_PIPELINE. */
export function pipelineFrom(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : UNRECORDED_PIPELINE;
}

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
  /** Hue and luminance −150..150, saturation −100..150 (−100 is grey). */
  readonly hue: number;
  readonly saturation: number;
  readonly luminance: number;
}

/** One colour-grading wheel, as Lopsy's ColorGradeWheel. */
export interface GradeWheel {
  /** Degrees, 0..360. */
  readonly hue: number;
  /** Tint strength, 0..100: 100 is the colour field's edge. */
  readonly saturation: number;
  /** −150..150. */
  readonly luminance: number;
}

export type GradeRange = 'shadows' | 'midtones' | 'highlights' | 'global';
export const GRADE_RANGES: readonly GradeRange[] = ['shadows', 'midtones', 'highlights', 'global'];

export interface ColorGrading {
  readonly shadows: GradeWheel;
  readonly midtones: GradeWheel;
  readonly highlights: GradeWheel;
  readonly global: GradeWheel;
  /** Overlap between the tonal ranges, 0..100 (Lopsy's default 50); 100 is full overlap. */
  readonly blending: number;
  /** Shifts the ranges toward shadows or highlights, −150..150. */
  readonly balance: number;
}

export type AreaKind = 'linear' | 'radial';

/**
 * A linear area: full effect on the (x0, y0) side, none past (x1, y1),
 * fading in between. Points are normalized to the unrotated source image
 * (like `CropRect`) and may lie outside it (-1..2).
 */
export interface LinearGeometry {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * A radial area: an ellipse centred on (cx, cy) with radii rx, ry (as
 * fractions of the source image's width and height), turned by `angle`
 * degrees, softened over `feather` percent of its radius. Normalized to
 * the unrotated source image.
 */
export interface RadialGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly angle: number;
  readonly feather: number;
}

export interface AreaAdjustments {
  readonly exposure: number;
  readonly contrast: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly temperature: number;
  readonly tint: number;
  readonly saturation: number;
  /** Large-detail local contrast. */
  readonly localContrast: number;
}

export const AREA_ADJUSTMENTS: readonly (keyof AreaAdjustments)[] = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'temperature',
  'tint',
  'saturation',
  'localContrast',
];

/** A local adjustment (spec 5.4 Areas, spec 7). */
export type Area = {
  readonly id: string;
  /** Inverts where the area applies. */
  readonly invert: boolean;
  /** How much of the adjustments apply, 0..100. */
  readonly amount: number;
  readonly name: string;
  readonly adjustments: AreaAdjustments;
  /**
   * The area's own further edits, kept as a recipe of its own: of it only
   * the settings `isAreaEffectPath` names are ever off their defaults
   * (whites, blacks, vibrance, curves, colour by hue, colour grading, local
   * contrast, sharpness, noise and finish). Rendered as the area's layer:
   * the photo with all its other edits, run through these, laid over it
   * through the area's mask. Leaves are `areas.<id>.fx.<recipe path>`.
   */
  readonly effects: Recipe;
} & ({ readonly kind: 'linear'; readonly geometry: LinearGeometry } | { readonly kind: 'radial'; readonly geometry: RadialGeometry });

/** The most live areas a recipe holds; past it, the newest are dropped. */
export const MAX_AREAS = 8;

export interface Recipe {
  readonly pipeline: number;
  readonly profile: { readonly id: string };
  readonly whiteBalance: {
    readonly mode: 'asShot' | 'custom';
    /** Relative shift, −150 (cooler) to 150 (warmer). Kelvin needs camera data (spec E9). */
    readonly temperature: number;
    /** Relative shift, −150 (greener) to 150 (more magenta). */
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
    /** Vignette amount, -100..100; positive darkens the corners (the engine's Finish takes it negated). */
    readonly vignette: number;
    /** Where the falloff is centred, 0..100 (engine/core/src/finish.rs). */
    readonly vignetteSize: number;
    /** -100 (rectangle) .. 0 (the frame's ellipse) .. 100 (circle). */
    readonly vignetteRoundness: number;
    /** Width of the falloff, 0..100. */
    readonly vignetteFeather: number;
    /** Film grain: amount and size 0..150, roughness 0..100; the per-photo seed is the app's, not the recipe's. */
    readonly grain: { readonly amount: number; readonly size: number; readonly roughness: number };
  };
  readonly framing: {
    readonly rotate: QuarterTurns;
    readonly flipH: boolean;
    readonly flipV: boolean;
    /** Straighten, degrees -45..45, applied before the crop. */
    readonly angle: number;
    readonly crop: CropRect | null;
  };
  /** Local contrast at large and small scales (−100..150), and haze removal (−150..100). */
  readonly localContrast: { readonly large: number; readonly small: number; readonly haze: number };
  readonly sharpness: {
    /** 0..150. */
    readonly amount: number;
    /** 0.5..3, in full-resolution pixels. */
    readonly radius: number;
    /** Masks sharpening to edges, 0..150. */
    readonly edges: number;
  };
  /** Noise reduction: luminance 0..150, colour and `detail` 0..100; `detail` keeps texture (default 50). */
  readonly noise: { readonly luminance: number; readonly color: number; readonly detail: number };
  /** One curve per channel; the identity is [{0,0},{1,1}]. */
  readonly curves: Readonly<Record<CurveChannel, readonly CurvePoint[]>>;
  readonly colorByHue: Readonly<Record<HueBand, HueAdjustment>>;
  readonly colorGrading: ColorGrading;
  /**
   * Live areas by ID; `liveAreas` lists them in creation order. Each field
   * is its own leaf (`areas.<id>.adjustments.exposure`), so edits to one
   * area on two devices merge; deletion is the leaf `areas.<id>.deleted`.
   */
  readonly areas: Readonly<Record<string, Area>>;
}

export interface RecipeRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * The far end of a slider whose 100 was only a cap: the engine's maths runs
 * on past it along the same line or curve (`SLIDER_END` in the engine's
 * `lopsy_core::scene_tone`). A value within the old range renders as it
 * always did.
 */
export const SLIDER_END = 150;

/** ±150: a slider open at both ends. */
const WIDE: RecipeRange = { min: -SLIDER_END, max: SLIDER_END, step: 1 };
/**
 * −100..150: a slider whose −100 is a real end (Saturation, Vibrance and a
 * band's saturation take chroma to 0 there; a local-contrast slider takes
 * its detail away exactly), open above.
 */
const FLOOR_AT_GREY: RecipeRange = { min: -100, max: SLIDER_END, step: 1 };
/** 0..150: an amount, open above. */
const AMOUNT: RecipeRange = { min: 0, max: SLIDER_END, step: 1 };

/**
 * Slider ranges for every numeric leaf, keyed by dotted path. A slider runs
 * to 150 where a value past 100 means something; an end that stayed at 100
 * is a real one, each named beside it.
 */
export const RECIPE_RANGES: Readonly<Record<string, RecipeRange>> = {
  'whiteBalance.temperature': WIDE,
  'whiteBalance.tint': WIDE,
  // Stops.
  'tone.exposure': { min: -5, max: 5, step: 0.01 },
  'tone.contrast': WIDE,
  'tone.highlights': WIDE,
  'tone.shadows': WIDE,
  'tone.whites': WIDE,
  'tone.blacks': WIDE,
  'color.vibrance': FLOOR_AT_GREY,
  'color.saturation': FLOOR_AT_GREY,
  // ±100 takes the corners to black or to white.
  'finish.vignette': { min: -100, max: 100, step: 1 },
  // 100 already puts the falloff's middle beyond the corners.
  'finish.vignetteSize': { min: 0, max: 100, step: 1 },
  // −100 is the rectangle, 100 the circle.
  'finish.vignetteRoundness': { min: -100, max: 100, step: 1 },
  // 100 is a falloff the whole way from the centre to the corners.
  'finish.vignetteFeather': { min: 0, max: 100, step: 1 },
  'finish.grain.amount': AMOUNT,
  'finish.grain.size': AMOUNT,
  // A mix of two octaves of grain, whole at 100.
  'finish.grain.roughness': { min: 0, max: 100, step: 1 },
  ...Object.fromEntries(
    HUE_BANDS.flatMap((band) => [
      [`colorByHue.${band}.hue`, WIDE],
      [`colorByHue.${band}.saturation`, FLOOR_AT_GREY],
      [`colorByHue.${band}.luminance`, WIDE],
    ]),
  ),
  ...Object.fromEntries(
    GRADE_RANGES.flatMap((range) => [
      // Degrees round the colour wheel.
      [`colorGrading.${range}.hue`, { min: 0, max: 360, step: 1 }],
      // 100 is the colour field's edge.
      [`colorGrading.${range}.saturation`, { min: 0, max: 100, step: 1 }],
      [`colorGrading.${range}.luminance`, WIDE],
    ]),
  ),
  // 100 is full overlap between the ranges.
  'colorGrading.blending': { min: 0, max: 100, step: 1 },
  'colorGrading.balance': WIDE,
  // Degrees.
  'framing.angle': { min: -45, max: 45, step: 0.1 },
  'localContrast.large': FLOOR_AT_GREY,
  'localContrast.small': FLOOR_AT_GREY,
  // +100 removes the whole measured veil.
  'localContrast.haze': { min: -SLIDER_END, max: 100, step: 1 },
  'sharpness.amount': AMOUNT,
  // Full-resolution pixels.
  'sharpness.radius': { min: 0.5, max: 3, step: 0.1 },
  'sharpness.edges': AMOUNT,
  'noise.luminance': AMOUNT,
  // 100 replaces the colour wholly with the smoothed colour.
  'noise.color': { min: 0, max: 100, step: 1 },
  // Past about 133 the filter's range would be negative.
  'noise.detail': { min: 0, max: 100, step: 1 },
  // Areas: keyed with `*` for the area ID; `rangeForPath` maps a real path here.
  // A share of the mask.
  'areas.*.amount': { min: 0, max: 100, step: 1 },
  // Stops.
  'areas.*.adjustments.exposure': { min: -4, max: 4, step: 0.01 },
  'areas.*.adjustments.contrast': WIDE,
  'areas.*.adjustments.highlights': WIDE,
  'areas.*.adjustments.shadows': WIDE,
  'areas.*.adjustments.temperature': WIDE,
  'areas.*.adjustments.tint': WIDE,
  'areas.*.adjustments.saturation': FLOOR_AT_GREY,
  'areas.*.adjustments.localContrast': FLOOR_AT_GREY,
  'areas.*.geometry.x0': { min: -1, max: 2, step: 0.001 },
  'areas.*.geometry.y0': { min: -1, max: 2, step: 0.001 },
  'areas.*.geometry.x1': { min: -1, max: 2, step: 0.001 },
  'areas.*.geometry.y1': { min: -1, max: 2, step: 0.001 },
  'areas.*.geometry.cx': { min: -1, max: 2, step: 0.001 },
  'areas.*.geometry.cy': { min: -1, max: 2, step: 0.001 },
  'areas.*.geometry.rx': { min: 0.005, max: 4, step: 0.001 },
  'areas.*.geometry.ry': { min: 0.005, max: 4, step: 0.001 },
  'areas.*.geometry.angle': { min: -180, max: 180, step: 0.1 },
  'areas.*.geometry.feather': { min: 0, max: 100, step: 1 },
};

/** An area's ID: letters, digits, '-' and '_' (a UUIDv7 from `newId`). */
const AREA_ID = /^[A-Za-z0-9_-]{1,64}$/;
const AREA_PATH = /^areas\.([A-Za-z0-9_-]{1,64})\.(.+)$/;

/** The range for a recipe path, area paths included ('areas.<id>.amount' -> 'areas.*.amount', 'areas.<id>.fx.tone.whites' -> 'tone.whites'). */
export function rangeForPath(path: string): RecipeRange | undefined {
  const m = AREA_PATH.exec(path);
  const field = m?.[2];
  if (field === undefined) return RECIPE_RANGES[path];
  // An area's own effect has the range of the recipe setting it mirrors.
  return RECIPE_RANGES[field.startsWith('fx.') ? field.slice('fx.'.length) : `areas.*.${field}`];
}

export const IDENTITY_CURVE: readonly CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const NEUTRAL_HUE: HueAdjustment = { hue: 0, saturation: 0, luminance: 0 };
const NEUTRAL_WHEEL: GradeWheel = { hue: 0, saturation: 0, luminance: 0 };
/** Lopsy's DEFAULT_GRADE_BLENDING. */
const DEFAULT_BLENDING = 50;

/** Colour grading that changes nothing: the recipe's default. */
const NEUTRAL_GRADE: ColorGrading = {
  shadows: NEUTRAL_WHEEL,
  midtones: NEUTRAL_WHEEL,
  highlights: NEUTRAL_WHEEL,
  global: NEUTRAL_WHEEL,
  blending: DEFAULT_BLENDING,
  balance: 0,
};

/** What follows 'areas.<id>.' in the path of one of an area's own effects. */
const AREA_FX = 'fx.';

/**
 * Whether a recipe path ('tone.whites', 'curves.red') is a setting an area
 * can also have of its own. Exposure, contrast, highlights, shadows,
 * temperature, tint and saturation are not: an area has those built in
 * (`AreaAdjustments`).
 */
export function isAreaEffectPath(path: string): boolean {
  if (path === 'tone.whites' || path === 'tone.blacks' || path === 'color.vibrance') return true;
  return AREA_EFFECT_GROUPS.some((prefix) => path.startsWith(prefix));
}

const AREA_EFFECT_GROUPS = ['curves.', 'colorByHue.', 'colorGrading.', 'localContrast.', 'sharpness.', 'noise.', 'finish.'] as const;

let areaEffectPathList: readonly string[] | null = null;

/** Every recipe path an area can have of its own, in the recipe's order. */
export function areaEffectPaths(): readonly string[] {
  areaEffectPathList ??= Object.keys(recipeToPaths(DEFAULT_RECIPE)).filter(isAreaEffectPath);
  return areaEffectPathList;
}

/** The leaf of area `areaId` that holds its own value of the recipe path `path`. */
export function areaEffectPath(areaId: string, path: string): string {
  return `areas.${areaId}.${AREA_FX}${path}`;
}

/**
 * The shaped vignette's defaults reproduce the amount-only one it replaces
 * (`filters/vignette.wgsl`: the frame's ellipse, smoothstep 0.5..1.2 of
 * the corner distance). In engine/core/src/finish.rs the falloff's
 * midpoint is 0.25 + 0.95·size/100 and its width 0.05 + 0.95·feather/100,
 * so midpoint 0.85 and width 0.7 give these; roundness 0 is the ellipse.
 */
export const DEFAULT_VIGNETTE_SIZE = 6000 / 95;
export const DEFAULT_VIGNETTE_FEATHER = 6500 / 95;

export const DEFAULT_RECIPE: Recipe = {
  pipeline: PIPELINE_VERSION,
  profile: { id: 'standard' },
  whiteBalance: { mode: 'asShot', temperature: 0, tint: 0 },
  tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
  color: { vibrance: 0, saturation: 0 },
  finish: {
    vignette: 0,
    vignetteSize: DEFAULT_VIGNETTE_SIZE,
    vignetteRoundness: 0,
    vignetteFeather: DEFAULT_VIGNETTE_FEATHER,
    grain: { amount: 0, size: 25, roughness: 50 },
  },
  framing: { rotate: 0, flipH: false, flipV: false, angle: 0, crop: null },
  localContrast: { large: 0, small: 0, haze: 0 },
  // No sharpening by default, RAW included: the owner's choice (spec 5.4).
  sharpness: { amount: 0, radius: 1, edges: 0 },
  noise: { luminance: 0, color: 0, detail: 50 },
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
  colorGrading: NEUTRAL_GRADE,
  areas: {},
};

export type RecipeLeaf =
  | number
  | string
  | boolean
  | CropRect
  | readonly CurvePoint[]
  | LinearGeometry
  | RadialGeometry
  | null;

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
  out['finish.vignetteSize'] = recipe.finish.vignetteSize;
  out['finish.vignetteRoundness'] = recipe.finish.vignetteRoundness;
  out['finish.vignetteFeather'] = recipe.finish.vignetteFeather;
  out['finish.grain.amount'] = recipe.finish.grain.amount;
  out['finish.grain.size'] = recipe.finish.grain.size;
  out['finish.grain.roughness'] = recipe.finish.grain.roughness;
  out['framing.rotate'] = recipe.framing.rotate;
  out['framing.flipH'] = recipe.framing.flipH;
  out['framing.flipV'] = recipe.framing.flipV;
  out['framing.angle'] = recipe.framing.angle;
  out['framing.crop'] = recipe.framing.crop;
  for (const [key, value] of Object.entries(recipe.localContrast)) out[`localContrast.${key}`] = value;
  for (const [key, value] of Object.entries(recipe.sharpness)) out[`sharpness.${key}`] = value;
  for (const [key, value] of Object.entries(recipe.noise)) out[`noise.${key}`] = value;
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
  for (const area of liveAreas(recipe)) Object.assign(out, areaPaths(area));
  return out;
}

/** An area's leaves, by full recipe path. */
function areaPaths(area: Area): Record<string, RecipeLeaf> {
  const p = `areas.${area.id}.`;
  const out: Record<string, RecipeLeaf> = {
    [`${p}kind`]: area.kind,
    [`${p}geometry`]: area.geometry,
    [`${p}invert`]: area.invert,
    [`${p}amount`]: area.amount,
    [`${p}name`]: area.name,
  };
  for (const key of AREA_ADJUSTMENTS) out[`${p}adjustments.${key}`] = area.adjustments[key];
  const effects = recipeToPaths(area.effects ?? DEFAULT_RECIPE);
  for (const path of areaEffectPaths()) out[`${p}${AREA_FX}${path}`] = effects[path] ?? null;
  return out;
}

/** The live areas in creation order (their IDs are time-ordered). */
export function liveAreas(recipe: Recipe): readonly Area[] {
  return Object.values(recipe.areas ?? {}).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const LINEAR_KEYS = ['x0', 'y0', 'x1', 'y1'] as const;
const RADIAL_KEYS = ['cx', 'cy', 'rx', 'ry', 'angle', 'feather'] as const;

/** Geometry of the kind, clamped to its ranges; null when malformed or degenerate. */
function geometryFrom(kind: AreaKind, value: unknown): LinearGeometry | RadialGeometry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = kind === 'linear' ? LINEAR_KEYS : RADIAL_KEYS;
  const out: Record<string, number> = {};
  for (const key of keys) {
    const n = v[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[key] = clamp(`areas.*.geometry.${key}`, n, n);
  }
  if (kind === 'linear') {
    const g = out as unknown as LinearGeometry;
    // Both ends at one point give no direction.
    if (Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 1e-4) return null;
    return { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
  }
  const g = out as unknown as RadialGeometry;
  return { cx: g.cx, cy: g.cy, rx: g.rx, ry: g.ry, angle: g.angle, feather: g.feather };
}

/** The areas the paths hold: tombstoned and malformed ones dropped, then the oldest MAX_AREAS kept. */
function areasFrom(paths: Readonly<Record<string, unknown>>): Record<string, Area> {
  const ids = new Set<string>();
  for (const path of Object.keys(paths)) {
    const m = AREA_PATH.exec(path);
    if (m?.[1] !== undefined) ids.add(m[1]);
  }
  const out: Record<string, Area> = {};
  let kept = 0;
  for (const id of [...ids].sort()) {
    if (kept >= MAX_AREAS) break;
    const area = areaFrom(id, paths);
    if (!area) continue;
    out[id] = area;
    kept++;
  }
  return out;
}

function areaFrom(id: string, paths: Readonly<Record<string, unknown>>): Area | null {
  const p = `areas.${id}.`;
  if (paths[`${p}deleted`] === true) return null;
  const kind = paths[`${p}kind`];
  if (kind !== 'linear' && kind !== 'radial') return null;
  const geometry = geometryFrom(kind, paths[`${p}geometry`]);
  if (!geometry) return null;
  const name = paths[`${p}name`];
  const adjustments = Object.fromEntries(
    AREA_ADJUSTMENTS.map((key) => [key, clamp(`${p}adjustments.${key}`, paths[`${p}adjustments.${key}`], 0)]),
  ) as unknown as AreaAdjustments;
  const common = {
    id,
    invert: paths[`${p}invert`] === true,
    amount: clamp(`${p}amount`, paths[`${p}amount`], 100),
    name: typeof name === 'string' ? name.slice(0, 100) : '',
    adjustments,
    // Read as a recipe is, so each leaf is held to its range and a missing or broken one is its default.
    effects: recipeFromPaths(Object.fromEntries(areaEffectPaths().map((path) => [path, paths[`${p}${AREA_FX}${path}`]]))),
  };
  return kind === 'linear'
    ? { ...common, kind, geometry: geometry as LinearGeometry }
    : { ...common, kind, geometry: geometry as RadialGeometry };
}

/** A leaf of an area, as `recipeFromPaths` would read it on its own; undefined to drop it. */
function areaLeafJson(path: string, value: unknown): Json | undefined {
  const m = AREA_PATH.exec(path);
  const field = m?.[2];
  if (field === undefined) return undefined;
  if (field === 'deleted') return value === true;
  if (field === 'kind') return value === 'linear' || value === 'radial' ? value : undefined;
  if (field === 'invert') return value === true;
  if (field === 'name') return typeof value === 'string' ? value.slice(0, 100) : '';
  if (field === 'amount') return clamp(path, value, 100);
  if (field.startsWith('adjustments.')) {
    return (AREA_ADJUSTMENTS as readonly string[]).includes(field.slice('adjustments.'.length)) ? clamp(path, value, 0) : undefined;
  }
  if (field.startsWith(AREA_FX)) {
    const effect = field.slice(AREA_FX.length);
    if (!areaEffectPaths().includes(effect)) return undefined;
    return recipeLeafJson(recipeToPaths(recipeFromPaths({ [effect]: value }))[effect] ?? null);
  }
  if (field === 'geometry') {
    // The kind is not known here: geometry that fits either is kept, and checked again when read.
    const g = geometryFrom('radial', value) ?? geometryFrom('linear', value);
    return g ? ({ ...g } as Json) : undefined;
  }
  return undefined;
}

export interface NewArea {
  readonly id: string;
  /** Recipe values that create it, for `editRecipe` or `applyRecipeValues`. */
  readonly values: Record<string, Json>;
}

/**
 * A new area with neutral adjustments over the middle of the image; null
 * when the recipe already holds MAX_AREAS. `id` is normally `newId()`.
 */
export function addArea(recipe: Recipe, kind: AreaKind, id: string, name = ''): NewArea | null {
  if (!AREA_ID.test(id)) throw new Error(`Invalid area ID: ${id}`);
  if (liveAreas(recipe).length >= MAX_AREAS) return null;
  const geometry: LinearGeometry | RadialGeometry =
    kind === 'linear'
      ? { x0: 0.5, y0: 0.25, x1: 0.5, y1: 0.75 }
      : { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, angle: 0, feather: 50 };
  const area = {
    id,
    invert: false,
    amount: 100,
    name,
    adjustments: Object.fromEntries(AREA_ADJUSTMENTS.map((k) => [k, 0])) as unknown as AreaAdjustments,
    effects: DEFAULT_RECIPE,
    ...(kind === 'linear' ? { kind, geometry: geometry as LinearGeometry } : { kind, geometry: geometry as RadialGeometry }),
  } as Area;
  const values: Record<string, Json> = { [`areas.${id}.deleted`]: false };
  // A new area's own effects are all at their defaults, which a missing leaf reads as: they are not written.
  for (const [path, value] of Object.entries(areaPaths(area))) {
    if (!path.startsWith(`areas.${id}.${AREA_FX}`)) values[path] = recipeLeafJson(value);
  }
  return { id, values };
}

/**
 * A copy of the live area `sourceId` under a new ID: its kind, shape,
 * amount, invert and adjustments, and its name with " copy" when it has
 * one. Null when there is no such area or the recipe already holds
 * MAX_AREAS.
 */
export function duplicateArea(recipe: Recipe, sourceId: string, id: string): NewArea | null {
  if (!AREA_ID.test(id)) throw new Error(`Invalid area ID: ${id}`);
  const source = (recipe.areas ?? {})[sourceId];
  if (!source || liveAreas(recipe).length >= MAX_AREAS) return null;
  const name = source.name.trim() ? `${source.name.trim()} copy`.slice(0, 100) : '';
  const copy = { ...source, id, name } as Area;
  const values: Record<string, Json> = { [`areas.${id}.deleted`]: false };
  for (const [path, value] of Object.entries(areaPaths(copy))) values[path] = recipeLeafJson(value);
  return { id, values };
}

/** The values that delete an area (a tombstone, so a concurrent edit cannot bring it back). */
export function removeArea(id: string): Record<string, Json> {
  return { [`areas.${id}.deleted`]: true };
}

/**
 * Values that delete every live area of `current` not in `next`: what a
 * whole-recipe write needs, since a missing area is otherwise left as is.
 */
export function removedAreaValues(current: Recipe, next: Recipe): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const id of Object.keys(current.areas ?? {})) if (!(next.areas ?? {})[id]) Object.assign(out, removeArea(id));
  return out;
}

function clamp(path: string, value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const range = rangeForPath(path);
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
    // A version written before pipelines were recorded was edited with the first one.
    pipeline: pipelineFrom(pipeline),
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
    finish: {
      vignette: num('finish.vignette', d.finish.vignette),
      vignetteSize: num('finish.vignetteSize', d.finish.vignetteSize),
      vignetteRoundness: num('finish.vignetteRoundness', d.finish.vignetteRoundness),
      vignetteFeather: num('finish.vignetteFeather', d.finish.vignetteFeather),
      grain: {
        amount: num('finish.grain.amount', d.finish.grain.amount),
        size: num('finish.grain.size', d.finish.grain.size),
        roughness: num('finish.grain.roughness', d.finish.grain.roughness),
      },
    },
    framing: {
      rotate: rotate === 90 || rotate === 180 || rotate === 270 ? rotate : 0,
      flipH: paths['framing.flipH'] === true,
      flipV: paths['framing.flipV'] === true,
      angle: num('framing.angle', 0),
      crop: isCropRect(paths['framing.crop']) ? paths['framing.crop'] : null,
    },
    localContrast: {
      large: num('localContrast.large', 0),
      small: num('localContrast.small', 0),
      haze: num('localContrast.haze', 0),
    },
    sharpness: {
      amount: num('sharpness.amount', d.sharpness.amount),
      radius: num('sharpness.radius', d.sharpness.radius),
      edges: num('sharpness.edges', d.sharpness.edges),
    },
    noise: {
      luminance: num('noise.luminance', d.noise.luminance),
      color: num('noise.color', d.noise.color),
      detail: num('noise.detail', d.noise.detail),
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
    areas: areasFrom(paths),
  };
}

const LATER_GROUPS = ['curves.', 'colorByHue.', 'colorGrading.', 'localContrast.', 'sharpness.', 'noise.'];
const LATER_PATHS: ReadonlySet<string> = new Set([
  'framing.angle',
  'framing.flipV',
  'finish.vignetteSize',
  'finish.vignetteRoundness',
  'finish.vignetteFeather',
  'finish.grain.amount',
  'finish.grain.size',
  'finish.grain.roughness',
]);

function isLaterPath(path: string): boolean {
  return LATER_PATHS.has(path) || LATER_GROUPS.some((g) => path.startsWith(g));
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

export type RecipeGroupId =
  | 'profile'
  | 'whiteBalance'
  | 'tone'
  | 'curves'
  | 'color'
  | 'colorGrading'
  | 'localContrast'
  | 'detail'
  | 'framing'
  | 'finish'
  | 'areas';

export interface RecipeGroup {
  readonly id: RecipeGroupId;
  /** As the Edit view and the Copy edits dialog name it. */
  readonly label: string;
  /** The recipe paths it owns start with one of these. */
  readonly prefixes: readonly string[];
}

/** The control groups of spec 5.4, in panel order. */
export const RECIPE_GROUPS: readonly RecipeGroup[] = [
  { id: 'profile', label: 'Profile', prefixes: ['profile.'] },
  { id: 'whiteBalance', label: 'White balance', prefixes: ['whiteBalance.'] },
  { id: 'tone', label: 'Tone', prefixes: ['tone.'] },
  { id: 'curves', label: 'Curves', prefixes: ['curves.'] },
  { id: 'color', label: 'Color', prefixes: ['color.', 'colorByHue.'] },
  { id: 'colorGrading', label: 'Color grading', prefixes: ['colorGrading.'] },
  { id: 'localContrast', label: 'Local contrast', prefixes: ['localContrast.'] },
  { id: 'detail', label: 'Detail', prefixes: ['sharpness.', 'noise.'] },
  { id: 'framing', label: 'Framing', prefixes: ['framing.'] },
  { id: 'finish', label: 'Finish', prefixes: ['finish.'] },
  // The UI calls areas masks; the id stays, as saved presets name it.
  { id: 'areas', label: 'Masks', prefixes: ['areas.'] },
];

/** Copy edits copies everything but framing and areas by default (spec 5.4, Copy and paste). */
export const DEFAULT_COPY_GROUPS: readonly RecipeGroupId[] = RECIPE_GROUPS.map((g) => g.id).filter(
  (id) => id !== 'framing' && id !== 'areas',
);

export function isRecipeGroupId(value: unknown): value is RecipeGroupId {
  return typeof value === 'string' && RECIPE_GROUPS.some((g) => g.id === value);
}

/** The group a recipe path belongs to; null for paths outside every group (`pipeline`). */
export function groupOfPath(path: string): RecipeGroupId | null {
  return RECIPE_GROUPS.find((g) => g.prefixes.some((p) => path.startsWith(p)))?.id ?? null;
}

/** A recipe leaf as JSON: crops and curve points are copied into plain objects. */
export function recipeLeafJson(value: RecipeLeaf): Json {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return (value as readonly CurvePoint[]).map((p) => ({ x: p.x, y: p.y }));
  return { ...(value as unknown as Record<string, number>) };
}

/** The recipe's values for the given groups, by path, ready for `applyRecipeValues` or a preset. */
export function pickGroups(recipe: Recipe, groups: readonly RecipeGroupId[]): Record<string, Json> {
  const wanted = new Set(groups);
  const out: Record<string, Json> = {};
  for (const [path, value] of Object.entries(recipeToPaths(recipe))) {
    const group = groupOfPath(path);
    if (group !== null && wanted.has(group)) out[path] = recipeLeafJson(value);
  }
  return out;
}

/** Whether every value of the group is at its default. */
export function isGroupDefault(recipe: Recipe, group: RecipeGroupId): boolean {
  const paths = recipeToPaths(recipe);
  return Object.keys(paths).every(
    (path) => groupOfPath(path) !== group || JSON.stringify(paths[path]) === JSON.stringify(DEFAULT_PATHS[path]),
  );
}

/**
 * Keeps only the paths that are recipe leaves, with values as
 * `recipeFromPaths` reads them (clamped, or the default when invalid).
 * `pipeline` is not kept: it belongs to a version, not to an edit, so a
 * paste or a preset never relabels the version it lands on.
 */
export function sanitizeRecipeValues(values: Readonly<Record<string, unknown>>): Record<string, Json> {
  const out: Record<string, Json> = {};
  // Area leaves are checked one by one: an edit names only some of an area's leaves.
  for (const [path, value] of Object.entries(values)) {
    if (!path.startsWith('areas.')) continue;
    const leaf = areaLeafJson(path, value);
    if (leaf !== undefined) out[path] = leaf;
  }
  const known = Object.keys(DEFAULT_PATHS).filter((p) => p !== 'pipeline' && Object.prototype.hasOwnProperty.call(values, p));
  if (known.length === 0) return out;
  const read = recipeToPaths(recipeFromPaths(values));
  for (const path of known) out[path] = recipeLeafJson(read[path] ?? null);
  return out;
}
