/**
 * The rendering pipeline's version, as versions and previews record it
 * (spec 6.9, 6.10). A version records the pipeline it was edited with in
 * its `recipe.pipeline` leaf, written once when the version is made; a
 * stored preview records the pipeline that rendered it in its reference
 * (the version's `thumb` and `screen` fields). Either one missing reads
 * as UNRECORDED_PIPELINE (recipe.ts), 1.
 */

import { PIPELINE_VERSION, recipeHash } from './recipe';
import type { PreviewRef, Version } from './types';

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
