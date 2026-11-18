/**
 * Copying edits between photos (spec 5.4) on photos-core's recipe groups:
 * what is on the clipboard, how a paste is named, and pasting it as one
 * history step per version (`applyRecipeValues`).
 */

import type { Json, LibrarySession, VersionId } from '@lopsy/photos-core/library/types';
import { DEFAULT_COPY_GROUPS, pickGroups, RECIPE_GROUPS, type Recipe, type RecipeGroupId } from '@lopsy/photos-core/library/recipe';

export interface RecipeGroupChoice {
  readonly id: RecipeGroupId;
  readonly label: string;
}

export const COPY_GROUPS: readonly RecipeGroupChoice[] = RECIPE_GROUPS.map((g) => ({ id: g.id, label: g.label }));

/** Everything but framing: a crop rarely suits another photo. */
export const DEFAULT_COPY_GROUP_IDS: readonly RecipeGroupId[] = DEFAULT_COPY_GROUPS;

/** The recipe's values in the chosen groups, by dotted path. */
export function pickRecipeValues(recipe: Recipe, groupIds: readonly RecipeGroupId[]): Record<string, Json> {
  return pickGroups(recipe, groupIds);
}

export interface CopiedEdits {
  readonly values: Readonly<Record<string, Json>>;
  readonly groupIds: readonly RecipeGroupId[];
  /** Where they came from, for the words: "harbour.jpg". */
  readonly sourceName: string;
}

export function pasteLabel(copied: CopiedEdits): string {
  const all = DEFAULT_COPY_GROUPS.every((g) => copied.groupIds.includes(g)) && copied.groupIds.length === DEFAULT_COPY_GROUPS.length;
  if (all) return 'Paste edits';
  const names = COPY_GROUPS.filter((g) => copied.groupIds.includes(g.id)).map((g) => g.label);
  return `Paste ${names.join(', ').toLowerCase()}`;
}

/** Applies the copied values to every version, one history step each. */
export function pasteRecipeValues(session: LibrarySession, versionIds: readonly VersionId[], copied: CopiedEdits): void {
  if (versionIds.length === 0 || Object.keys(copied.values).length === 0) return;
  session.applyRecipeValues(versionIds, copied.values, pasteLabel(copied));
}

/** Only real group ids (the dialog hands back strings). */
export function asGroupIds(ids: readonly string[]): RecipeGroupId[] {
  return COPY_GROUPS.map((g) => g.id).filter((id) => ids.includes(id));
}
