/**
 * `?develop=legacy` in the URL of a development build: every engine the
 * page makes keeps the working space off and takes the legacy calls
 * (develop-stages.ts), as on a GPU without float render targets, while
 * the texture pool and the RAW decode stay float as the GPU has them. That
 * is the chain Photonamous ran before the working space, so the two can be
 * measured against each other in one build on one machine
 * (docs/photonamous-setup.md, "Measuring on the real GPU"). Production
 * builds ignore it: there the GPU alone decides.
 */

export type DevelopOverride = 'legacy' | null;

/** The override `search` asks for; null outside a development build or without the query. */
export function developOverrideFrom(search: string, isDevelopment: boolean): DevelopOverride {
  if (!isDevelopment) return null;
  return new URLSearchParams(search).get('develop') === 'legacy' ? 'legacy' : null;
}

/** Read once, at page load: the page keeps the chain it started with. */
export const developOverride: DevelopOverride = developOverrideFrom(
  typeof location === 'undefined' ? '' : location.search,
  import.meta.env.DEV,
);

/** Whether an engine on a GPU with (or without) float targets edits in the working space. */
export function usesWorkingSpace(hasFloatTargets: boolean, override: DevelopOverride = developOverride): boolean {
  return hasFloatTargets && override !== 'legacy';
}
