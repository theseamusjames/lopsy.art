/**
 * The rendering pipeline's version, as versions and previews record it
 * (spec 6.9, 6.10). A version records the pipeline it was edited with in
 * its `recipe.pipeline` leaf, written once when the version is made; a
 * stored preview records the pipeline that rendered it in its reference
 * (the version's `thumb` and `screen` fields). Either one missing reads
 * as UNRECORDED_PIPELINE (recipe.ts), 1.
 */

import { PIPELINE_VERSION, recipeHash, type Recipe } from './recipe';
import type { PreviewRef, Version } from './types';

/**
 * Whether the recipe was edited with a pipeline newer than this build's
 * (a library edited on a newer build, opened on an older cached one).
 * This build cannot render it as it was meant, and must not write to it:
 * its reading of the recipe drops or clamps the settings it does not
 * know, so writing that reading back would lose them.
 */
export function isNewerPipeline(recipe: Pick<Recipe, 'pipeline'>): boolean {
  return recipe.pipeline > PIPELINE_VERSION;
}

export const NEWER_PIPELINE_MESSAGE =
  'This version was edited with a newer version of Photonamous. Reload to update the app before changing it.';

/** Thrown by a recipe command on a version (or with a recipe) from a newer pipeline than this build's. */
export class NewerPipelineError extends Error {
  constructor() {
    super(NEWER_PIPELINE_MESSAGE);
    this.name = 'NewerPipelineError';
  }
}

/**
 * Whether a stored preview shows the version as this build would render
 * it now: rendered from the same recipe (its hash) by this build's
 * pipeline, for a version this build can render. A preview from an older
 * pipeline is stale, as one of an older edit is, and is rendered again.
 * `hash` is the version's recipe hash, for callers that already have it.
 *
 * While PIPELINE_VERSION is 1 this is `preview.pipeline ===
 * version.recipe.pipeline === PIPELINE_VERSION`. A version from an older
 * pipeline keeps its pipeline (only an explicit update changes it), so
 * requiring the version to be on this build's pipeline too would leave
 * its previews stale after every render, and render them again each
 * time; only a newer version is ruled out.
 */
export function isPreviewCurrent(preview: PreviewRef | null, version: Version, hash: string = recipeHash(version.recipe)): boolean {
  return (
    preview !== null &&
    preview.recipeHash === hash &&
    preview.pipeline === PIPELINE_VERSION &&
    version.recipe.pipeline <= PIPELINE_VERSION
  );
}
