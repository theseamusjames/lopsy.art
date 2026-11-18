/**
 * The Edit view's control groups (spec 5.4, the POC subset) and the recipe
 * changes they make. Names are Lopsy's own (spec 5.8).
 */

import {
  DEFAULT_RECIPE,
  RECIPE_RANGES,
  recipeFromPaths,
  recipeToPaths,
  type QuarterTurns,
  type Recipe,
  type RecipeRange,
} from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';

export interface ControlDef {
  /** Dotted recipe path, a key of RECIPE_RANGES. */
  readonly path: string;
  readonly label: string;
}

export interface GroupDef {
  readonly id: 'whiteBalance' | 'tone' | 'color' | 'finish';
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
    id: 'finish',
    title: 'Finish',
    controls: [{ path: 'finish.vignette', label: 'Vignette' }],
  },
];

const FALLBACK_RANGE: RecipeRange = { min: -100, max: 100, step: 1 };

export function rangeOf(path: string): RecipeRange {
  return RECIPE_RANGES[path] ?? FALLBACK_RANGE;
}

export function numberAt(recipe: Recipe, path: string): number {
  const value = recipeToPaths(recipe)[path];
  return typeof value === 'number' ? value : 0;
}

export function defaultAt(path: string): number {
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

/** The recipe turned a quarter turn; the crop is dropped, as it was drawn on the old orientation. */
export function rotateRecipe(recipe: Recipe, isClockwise: boolean): Recipe {
  const turns = (recipe.framing.rotate / 90 + (isClockwise ? 1 : 3)) % 4;
  return { ...recipe, framing: { ...recipe.framing, rotate: (turns * 90) as QuarterTurns, crop: null } };
}

export function flipRecipe(recipe: Recipe): Recipe {
  return { ...recipe, framing: { ...recipe.framing, flipH: !recipe.framing.flipH, crop: null } };
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
