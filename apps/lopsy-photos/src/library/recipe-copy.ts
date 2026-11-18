/**
 * Copying edits between photos (spec 5.4): the recipe's groups, picking
 * some of them as dotted-path values, and pasting those onto versions.
 * Pure apart from `pasteRecipeValues`, which goes through the session.
 *
 * The group list is local until photos-core's RECIPE_GROUPS lands; the
 * ids are the recipe's top-level keys, so the two agree.
 */

import type { Json, LibrarySession, VersionId } from '@lopsy/photos-core/library/types';
import { recipeToPaths, type Recipe } from '@lopsy/photos-core/library/recipe';

export interface RecipeGroupChoice {
  /** The recipe's top-level key. */
  readonly id: string;
  readonly label: string;
}

export const COPY_GROUPS: readonly RecipeGroupChoice[] = [
  { id: 'profile', label: 'Look' },
  { id: 'whiteBalance', label: 'White balance' },
  { id: 'tone', label: 'Light' },
  { id: 'curves', label: 'Curves' },
  { id: 'color', label: 'Colour' },
  { id: 'colorByHue', label: 'Colour by hue' },
  { id: 'colorGrading', label: 'Colour grading' },
  { id: 'finish', label: 'Finish' },
  { id: 'framing', label: 'Crop and rotation' },
];

/** Everything but framing: a crop rarely suits another photo. */
export const DEFAULT_COPY_GROUP_IDS: readonly string[] = COPY_GROUPS.filter((g) => g.id !== 'framing').map((g) => g.id);

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

/** The recipe's values in the chosen groups, by dotted path. */
export function pickRecipeValues(recipe: Recipe, groupIds: readonly string[]): Record<string, Json> {
  const wanted = new Set(groupIds);
  const out: Record<string, Json> = {};
  for (const [path, value] of Object.entries(recipeToPaths(recipe))) {
    const group = path.slice(0, path.indexOf('.') < 0 ? path.length : path.indexOf('.'));
    if (wanted.has(group)) out[path] = toJson(value);
  }
  return out;
}

export interface CopiedEdits {
  readonly values: Readonly<Record<string, Json>>;
  readonly groupIds: readonly string[];
  /** Where they came from, for the words: "harbour.jpg". */
  readonly sourceName: string;
}

export function pasteLabel(copied: CopiedEdits): string {
  const names = COPY_GROUPS.filter((g) => copied.groupIds.includes(g.id)).map((g) => g.label);
  return names.length === COPY_GROUPS.length - 1 && !copied.groupIds.includes('framing') ? 'Paste edits' : `Paste ${names.join(', ').toLowerCase()}`;
}

type ApplyRecipeValues = (versionIds: readonly VersionId[], values: Readonly<Record<string, Json>>, label: string) => void;

/**
 * Applies the values to every version, one history step each. Uses the
 * session's `applyRecipeValues` when it has one (photos-core), else one
 * editRecipe per version.
 */
export function pasteRecipeValues(session: LibrarySession, versionIds: readonly VersionId[], copied: CopiedEdits): void {
  if (versionIds.length === 0 || Object.keys(copied.values).length === 0) return;
  const label = pasteLabel(copied);
  const apply: unknown = Reflect.get(session, 'applyRecipeValues');
  if (typeof apply === 'function') {
    (apply as ApplyRecipeValues).call(session, versionIds, copied.values, label);
    return;
  }
  for (const id of versionIds) session.editRecipe(id, copied.values, label);
}
