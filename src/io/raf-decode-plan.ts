/**
 * Sizing for the parallel RAF decode. Every worker holds its own WASM
 * instance whose memory grows to its largest band and never shrinks, so
 * the pool is capped even on machines with many cores.
 */

export const MAX_RAF_WORKERS = 8;

/**
 * Bands per worker: more than one lets a worker that finishes early pick
 * up another band, and lets uploads overlap rendering. More than a few
 * mostly adds halo rows (rendered twice, then discarded).
 */
export const RAF_BANDS_PER_WORKER = 2;

export function rafWorkerCount(hardwareConcurrency: number | undefined): number {
  const cores = Number.isFinite(hardwareConcurrency) && hardwareConcurrency ? Math.floor(hardwareConcurrency) : 4;
  return Math.min(MAX_RAF_WORKERS, Math.max(1, cores));
}
