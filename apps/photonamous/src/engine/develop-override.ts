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
 * no float targets, so a RAW photo decodes to its finished look (in bands
 * where its format has them) and is edited as an ordinary photo, as on such a GPU (the texture pool is still
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

/**
 * `?texture-limit=N` in the URL of a development build: every engine the
 * page makes takes the GPU's largest texture side to be N (at most what the
 * GPU has), so an ordinary photo is larger than the GPU can edit and opens
 * reduced, and its exports are made in tiles (tile-plan.ts), on any GPU.
 * The e2e suite reaches tiles this way. `import.meta.env.DEV` is replaced
 * with `false` in a production build, so there `textureLimitOverride` is
 * the constant null and the override is folded away with the query unread.
 */
export const MIN_TEXTURE_LIMIT_OVERRIDE = 256;

/** The limit `search` asks for; null outside a development build, without the query, or for a value under `MIN_TEXTURE_LIMIT_OVERRIDE`. */
export function textureLimitOverrideFrom(search: string, isDevelopment: boolean): number | null {
  if (!isDevelopment) return null;
  const value = Number(new URLSearchParams(search).get('texture-limit'));
  return Number.isInteger(value) && value >= MIN_TEXTURE_LIMIT_OVERRIDE ? value : null;
}

/** Read once, at page load. */
export const textureLimitOverride: number | null = import.meta.env.DEV
  ? textureLimitOverrideFrom(typeof location === 'undefined' ? '' : location.search, true)
  : null;

/** The GPU's largest texture side as the app takes it: the GPU's own, or the override when smaller. */
export function effectiveTextureLimit(gpuLimit: number, override: number | null = textureLimitOverride): number {
  return override !== null ? Math.min(gpuLimit, override) : gpuLimit;
}
