/**
 * The Edit view's control groups (spec 5.4, the POC subset) and the recipe
 * changes they make. Names are Lopsy's own (spec 5.8).
 */

import {
  DEFAULT_RECIPE,
  RECIPE_RANGES,
  rangeForPath,
  recipeFromPaths,
  recipeToPaths,
  type QuarterTurns,
  type Recipe,
  type RecipeRange,
} from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import {
  RECIPE_GROUPS,
  isGroupDefault as isRecipeGroupDefault,
  type RecipeGroupId,
  CURVE_CHANNELS,
  GRADE_RANGES,
  HUE_BANDS,
  IDENTITY_CURVE,
  type CurveChannel,
  type GradeRange,
  type HueBand,
} from '@lopsy/photos-core/library/recipe';

export interface ControlDef {
  /** Dotted recipe path, a key of RECIPE_RANGES. */
  readonly path: string;
  readonly label: string;
  /** How the history names a change, when the slider label alone is ambiguous ('Red hue'). */
  readonly historyLabel?: string;
}

export interface GroupDef {
  readonly id: 'whiteBalance' | 'tone' | 'color' | 'localContrast' | 'detail' | 'finish' | 'framing';
  readonly title: string;
  readonly controls: readonly ControlDef[];
}

export const GROUPS: readonly GroupDef[] = [
  {
    id: 'whiteBalance',
    title: 'White balance',
    controls: [
      { path: 'whiteBalance.temperature', label: 'Temperature' },
      { path: 'whiteBalance.tint', label: 'Tint' },
    ],
  },
  {
    id: 'tone',
    title: 'Tone',
    controls: [
      { path: 'tone.exposure', label: 'Exposure' },
      { path: 'tone.contrast', label: 'Contrast' },
      { path: 'tone.highlights', label: 'Highlights' },
      { path: 'tone.shadows', label: 'Shadows' },
      { path: 'tone.whites', label: 'Whites' },
      { path: 'tone.blacks', label: 'Blacks' },
    ],
  },
  {
    id: 'color',
    title: 'Color',
    controls: [
      { path: 'color.vibrance', label: 'Vibrance' },
      { path: 'color.saturation', label: 'Saturation' },
    ],
  },
  {
    id: 'localContrast',
    title: 'Local contrast',
    controls: [
      { path: 'localContrast.large', label: 'Large details' },
      { path: 'localContrast.small', label: 'Small details' },
      { path: 'localContrast.haze', label: 'Haze' },
    ],
  },
  {
    id: 'detail',
    title: 'Sharpness & noise',
    controls: [
      { path: 'sharpness.amount', label: 'Sharpen', historyLabel: 'Sharpen' },
      { path: 'sharpness.radius', label: 'Radius', historyLabel: 'Sharpen radius' },
      { path: 'sharpness.edges', label: 'Edges only', historyLabel: 'Sharpen edges only' },
      { path: 'noise.luminance', label: 'Noise', historyLabel: 'Noise reduction' },
      { path: 'noise.color', label: 'Color noise', historyLabel: 'Color noise reduction' },
      { path: 'noise.detail', label: 'Keep detail', historyLabel: 'Noise keep detail' },
    ],
  },
  {
    id: 'finish',
    title: 'Finish',
    controls: [{ path: 'finish.vignette', label: 'Vignette' }],
  },
];

const FALLBACK_RANGE: RecipeRange = { min: -100, max: 100, step: 1 };

export function rangeOf(path: string): RecipeRange {
  return rangeForPath(path) ?? FALLBACK_RANGE;
}

export function numberAt(recipe: Recipe, path: string): number {
  const value = recipeToPaths(recipe)[path];
  return typeof value === 'number' ? value : 0;
}

export function defaultAt(path: string): number {
  // A new area applies in full; its other numbers start at 0.
  if (/^areas\.[^.]+\.amount$/.test(path)) return 100;
  return numberAt(DEFAULT_RECIPE, path);
}

/** Recipe with dotted-path changes applied, clamped to their ranges. */
export function applyChanges(recipe: Recipe, changes: Readonly<Record<string, Json>>): Recipe {
  return recipeFromPaths({ ...recipeToPaths(recipe), ...changes });
}

function decimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** 'Exposure +0.30', 'Contrast −12', 'Vignette 0'. */
export function changeLabel(label: string, path: string, value: number): string {
  const d = decimals(rangeOf(path).step);
  const rounded = Number(value.toFixed(d));
  const magnitude = Math.abs(rounded).toFixed(d);
  if (rounded > 0) return `${label} +${magnitude}`;
  if (rounded < 0) return `${label} −${magnitude}`;
  return `${label} ${magnitude}`;
}

/** The change one slider makes. Moving Temperature or Tint makes the white balance custom. */
export function sliderChanges(path: string, value: number): Record<string, Json> {
  const changes: Record<string, Json> = { [path]: value };
  if (path.startsWith('whiteBalance.')) changes['whiteBalance.mode'] = 'custom';
  return changes;
}

/** The changes that put a group back to its defaults; empty when it already is. */
export function groupResetChanges(recipe: Recipe, group: GroupDef): Record<string, Json> {
  const changes: Record<string, Json> = {};
  for (const control of group.controls) {
    const def = defaultAt(control.path);
    if (numberAt(recipe, control.path) !== def) changes[control.path] = def;
  }
  if (group.id === 'whiteBalance' && recipe.whiteBalance.mode !== DEFAULT_RECIPE.whiteBalance.mode) {
    changes['whiteBalance.mode'] = DEFAULT_RECIPE.whiteBalance.mode;
  }
  return changes;
}

export function isGroupDefault(recipe: Recipe, group: GroupDef): boolean {
  return Object.keys(groupResetChanges(recipe, group)).length === 0;
}

/** The recipe turned a quarter turn. The crop is stored on the unrotated image, so it turns with it. */
export function rotateRecipe(recipe: Recipe, isClockwise: boolean): Recipe {
  const turns = (recipe.framing.rotate / 90 + (isClockwise ? 1 : 3)) % 4;
  return { ...recipe, framing: { ...recipe.framing, rotate: (turns * 90) as QuarterTurns } };
}

export function flipRecipe(recipe: Recipe): Recipe {
  return { ...recipe, framing: { ...recipe.framing, flipH: !recipe.framing.flipH } };
}

/** What the "before" view shows: the default edit, in the photo's current framing. */
export function beforeRecipe(recipe: Recipe): Recipe {
  return { ...DEFAULT_RECIPE, framing: recipe.framing };
}

/** The tone changes that take `recipe` to `tone`, only for values that differ. */
export function toneChanges(recipe: Recipe, tone: Recipe['tone']): Record<string, Json> {
  const changes: Record<string, Json> = {};
  for (const key of Object.keys(recipe.tone) as (keyof Recipe['tone'])[]) {
    const value = tone[key];
    if (Number.isFinite(value) && value !== recipe.tone[key]) changes[`tone.${key}`] = value;
  }
  return changes;
}

// ---- Curves, Color by hue, Color Grading ----------------------------

export interface CurveChannelDef {
  readonly id: CurveChannel;
  readonly label: string;
  /** Line colour in the editor. */
  readonly color: string;
}

export const CURVE_CHANNEL_DEFS: readonly CurveChannelDef[] = CURVE_CHANNELS.map((id) => ({
  id,
  label: id === 'luminance' ? 'Luminance' : id === 'red' ? 'Red' : id === 'green' ? 'Green' : 'Blue',
  color: id === 'luminance' ? 'var(--color-text-primary)' : id === 'red' ? '#e05555' : id === 'green' ? '#55c055' : '#5580e0',
}));

/** The changes that straighten every bent curve; empty when all are straight. */
export function curvesResetChanges(recipe: Recipe): Record<string, Json> {
  const changes: Record<string, Json> = {};
  for (const ch of CURVE_CHANNELS) {
    const points = recipe.curves[ch];
    const isStraight = points.length === 2 && points[0]?.x === 0 && points[0]?.y === 0 && points[1]?.x === 1 && points[1]?.y === 1;
    if (!isStraight) changes[`curves.${ch}`] = IDENTITY_CURVE.map((p) => ({ x: p.x, y: p.y }));
  }
  return changes;
}

export interface TabDef {
  readonly id: string;
  readonly label: string;
  readonly controls: readonly ControlDef[];
}

const HUE_BAND_LABELS: Readonly<Record<HueBand, string>> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  aqua: 'Aqua',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
};

const HUE_FIELDS = [
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'luminance', label: 'Luminance' },
] as const;

/** Color by hue: a tab per property, a slider per hue band. */
export const COLOR_BY_HUE_TABS: readonly TabDef[] = HUE_FIELDS.map((field) => ({
  id: field.id,
  label: field.label,
  controls: HUE_BANDS.map((band) => ({
    path: `colorByHue.${band}.${field.id}`,
    label: HUE_BAND_LABELS[band],
    historyLabel: `${HUE_BAND_LABELS[band]} ${field.label.toLowerCase()}`,
  })),
}));

const GRADE_LABELS: Readonly<Record<GradeRange, string>> = {
  shadows: 'Shadows',
  midtones: 'Midtones',
  highlights: 'Highlights',
  global: 'Global',
};

/** Color Grading: a tab per range with its wheel as three sliders. */
export const COLOR_GRADING_TABS: readonly TabDef[] = GRADE_RANGES.map((range) => ({
  id: range,
  label: GRADE_LABELS[range],
  controls: HUE_FIELDS.map((field) => ({
    path: `colorGrading.${range}.${field.id}`,
    label: field.label,
    historyLabel: `${GRADE_LABELS[range]} ${field.label.toLowerCase()}`,
  })),
}));

export const COLOR_GRADING_SHARED: readonly ControlDef[] = [
  { path: 'colorGrading.blending', label: 'Blending' },
  { path: 'colorGrading.balance', label: 'Balance' },
];

/** The changes that put numeric controls back to their defaults; empty when they are. */
export function resetChangesFor(recipe: Recipe, controls: readonly ControlDef[]): Record<string, Json> {
  const changes: Record<string, Json> = {};
  for (const control of controls) {
    const def = defaultAt(control.path);
    if (numberAt(recipe, control.path) !== def) changes[control.path] = def;
  }
  return changes;
}

/** The Framing group's Straighten angle, once the recipe has one (framing.angle). */
export const FRAMING_GROUP: GroupDef | null =
  'framing.angle' in RECIPE_RANGES ? { id: 'framing', title: 'Straighten', controls: [{ path: 'framing.angle', label: 'Angle', historyLabel: 'Straighten' }] } : null;

/** The groups a new preset starts with: the ones this edit changed, framing left out (spec 5.4). */
export function changedGroups(recipe: Recipe): RecipeGroupId[] {
  return RECIPE_GROUPS.map((g) => g.id).filter((id) => id !== 'framing' && !isRecipeGroupDefault(recipe, id));
}
