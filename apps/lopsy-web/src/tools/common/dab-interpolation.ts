import type { Point } from '../../types';

/**
 * Build a flat [x,y,x,y,...] Float64Array of dab positions interpolated
 * between two points at a fixed spacing. Used by tools that batch dab
 * applications to the GPU (dodge/burn, smudge, stamp).
 *
 * Returns just the destination point if the segment is shorter than one
 * spacing step.
 */
export function interpolateFlat(from: Point, to: Point, spacing: number): Float64Array {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < spacing) return new Float64Array([to.x, to.y]);
  const steps = Math.floor(dist / spacing);
  const arr = new Float64Array(steps * 2);
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) * spacing / dist;
    arr[i * 2] = from.x + dx * t;
    arr[i * 2 + 1] = from.y + dy * t;
  }
  return arr;
}

/**
 * Dab positions from `from` toward `to`, exactly `spacing` apart, starting
 * one step past `from`. Unlike {@link interpolateFlat}, a segment shorter
 * than one step emits nothing: the caller keeps the last dab as its anchor
 * and the leftover distance counts toward the next step. Dab placement then
 * depends only on the distance travelled, not on how often the pointer
 * reports, so a slow drag and a fast one lay the same dabs.
 */
export function interpolateDeferred(from: Point, to: Point, spacing: number): Float64Array {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = dist < spacing ? 0 : Math.floor(dist / spacing);
  const arr = new Float64Array(steps * 2);
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) * spacing / dist;
    arr[i * 2] = from.x + dx * t;
    arr[i * 2 + 1] = from.y + dy * t;
  }
  return arr;
}
