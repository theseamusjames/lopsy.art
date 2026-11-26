/**
 * `?develop=legacy` in the URL of a development build: every engine the
 * page makes keeps the working space off and takes the legacy calls
 * (develop-stages.ts), as on a GPU without float render targets, while
 * the texture pool and the RAW decode stay float as the GPU has them. That
 * is the chain Photonamous ran before the working space, so the two can be
 * measured against each other in one build on one machine
 * (docs/photonamous-setup.md, "Measuring on the real GPU"). Production
 * builds ignore it: there the GPU alone decides.
 *
 * `?develop=no-float` goes further: the app also treats the GPU as having
 * no float targets, so a RAF decodes to the finished look in bands and is
 * edited as an ordinary photo, as on such a GPU (the texture pool is still
 * the GPU's). Every GPU the browser tests run on has float targets; this
 * is how they reach that path (e2e/raw-parity.spec.ts).
 */

export type DevelopOverride = 'legacy' | 'no-float' | null;

/** The override `search` asks for; null outside a development build or without the query. */
export function developOverrideFrom(search: string, isDevelopment: boolean): DevelopOverride {
  if (!isDevelopment) return null;
  const value = new URLSearchParams(search).get('develop');
  return value === 'legacy' || value === 'no-float' ? value : null;
}

/** Read once, at page load: the page keeps the chain it started with. */
export const developOverride: DevelopOverride = developOverrideFrom(
  typeof location === 'undefined' ? '' : location.search,
  import.meta.env.DEV,
);

/** Whether an engine on a GPU with (or without) float targets edits in the working space. */
export function usesWorkingSpace(hasFloatTargets: boolean, override: DevelopOverride = developOverride): boolean {
  return hasFloatTargets && override === null;
}

/** Whether the app takes the GPU for one with float targets (the RAW decode's linear path). */
export function treatsAsFloat(hasFloatTargets: boolean, override: DevelopOverride = developOverride): boolean {
  return hasFloatTargets && override !== 'no-float';
}
