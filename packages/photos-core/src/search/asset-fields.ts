/** Derived asset fields shared by rules, facets, dates and bursts. */

import { DEFAULT_RECIPE, recipeToPaths } from '../library/recipe';
import type { Recipe } from '../library/recipe';
import type { Asset, LibraryView, Version } from '../library/types';

/** The camera as people name it: the model, else the make; '' when unknown. */
export function cameraName(asset: Asset): string {
  return asset.camera?.model || asset.camera?.make || '';
}

/** 'YYYY-MM-DD' of the capture, else of the import. */
export function assetDay(asset: Asset): string {
  return (asset.capturedAt ?? asset.importedAt).slice(0, 10);
}

const editedByVersion = new WeakMap<Version, boolean>();
const DEFAULT_PATHS = Object.entries(recipeToPaths(DEFAULT_RECIPE));

/** Same answer as recipe.ts `isDefaultRecipe`, without hashing both recipes per call. */
function isDefault(recipe: Recipe): boolean {
  if (recipe === DEFAULT_RECIPE) return true;
  const paths = recipeToPaths(recipe);
  return DEFAULT_PATHS.every(([key, value]) => {
    const other = paths[key];
    return typeof value === 'object' && value !== null ? JSON.stringify(value) === JSON.stringify(other) : value === other;
  });
}

/** Whether the primary version's recipe changes anything. Cached per version object. */
export function isEdited(asset: Asset, view: LibraryView): boolean {
  const version = view.versions.get(asset.primaryVersionId);
  if (!version) return false;
  let edited = editedByVersion.get(version);
  if (edited === undefined) {
    edited = !isDefault(version.recipe);
    editedByVersion.set(version, edited);
  }
  return edited;
}

/**
 * Capture time as milliseconds of the camera's local clock (the offset is
 * ignored: shots are compared with others from the same camera); null
 * when unknown or malformed.
 */
export function captureMs(asset: Asset): number | null {
  const t = asset.capturedAt;
  if (!t || t.length < 19 || t[4] !== '-' || t[7] !== '-' || t[10] !== 'T') return null;
  const ms = Date.UTC(
    Number(t.slice(0, 4)),
    Number(t.slice(5, 7)) - 1,
    Number(t.slice(8, 10)),
    Number(t.slice(11, 13)),
    Number(t.slice(14, 16)),
    Number(t.slice(17, 19)),
  );
  return Number.isNaN(ms) ? null : ms;
}
