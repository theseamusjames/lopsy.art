import type { PathAnchor } from '../path/path';
import type { Point } from '../../types';

export interface GlyphPlacement {
  /** Index into the text string this placement belongs to. */
  charIndex: number;
  /** Character being placed. */
  char: string;
  /** Document-space X position (centre of the glyph baseline). */
  x: number;
  /** Document-space Y position (baseline). */
  y: number;
  /** Rotation angle in radians, matching the path tangent at this point. */
  rotation: number;
}

interface PathSample {
  distance: number;
  point: Point;
  /** Unit tangent vector at this sample. */
  tx: number;
  ty: number;
}

function bezierPoint(
  p0: Point,
  cp1: Point,
  cp2: Point,
  p1: Point,
  t: number,
): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * p1.y,
  };
}

/**
 * Build a dense arc-length lookup table from the path anchors.
 * Each entry stores cumulative distance, the point on the curve and the
 * unit tangent (forward direction) at that point.
 */
export function buildPathLookupTable(
  anchors: readonly PathAnchor[],
  closed: boolean,
  stepSize = 1,
): PathSample[] {
  const samples: PathSample[] = [];
  if (anchors.length < 2) return samples;

  let totalDist = 0;
  const segCount = closed ? anchors.length : anchors.length - 1;

  for (let seg = 0; seg < segCount; seg++) {
    const a = anchors[seg]!;
    const b = anchors[(seg + 1) % anchors.length]!;
    const cp1 = a.handleOut ?? a.point;
    const cp2 = b.handleIn ?? b.point;

    // Estimate number of steps needed for this segment.
    // Use a rough chord length to set the step count.
    const dx = b.point.x - a.point.x;
    const dy = b.point.y - a.point.y;
    const roughLen = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(8, Math.ceil(roughLen / stepSize));

    let prev = bezierPoint(a.point, cp1, cp2, b.point, 0);

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const curr = bezierPoint(a.point, cp1, cp2, b.point, t);

      const ddx = curr.x - prev.x;
      const ddy = curr.y - prev.y;
      const segDist = Math.sqrt(ddx * ddx + ddy * ddy);

      if (segDist === 0) {
        prev = curr;
        continue;
      }

      totalDist += segDist;
      samples.push({
        distance: totalDist,
        point: curr,
        tx: ddx / segDist,
        ty: ddy / segDist,
      });

      prev = curr;
    }
  }

  return samples;
}

/**
 * Linearly interpolate a PathSample at the requested arc-length distance.
 * Returns null if `dist` is beyond the end of the path.
 */
function sampleAtDistance(table: PathSample[], dist: number): PathSample | null {
  if (table.length === 0) return null;
  if (dist <= 0) return table[0] ?? null;

  const last = table[table.length - 1];
  if (!last || dist > last.distance) return null;

  // Binary search
  let lo = 0;
  let hi = table.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid]!.distance < dist) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const curr = table[lo]!;
  if (lo === 0 || curr.distance === dist) return curr;

  const prev = table[lo - 1]!;
  const t = (dist - prev.distance) / (curr.distance - prev.distance);

  // Interpolate position
  const x = prev.point.x + t * (curr.point.x - prev.point.x);
  const y = prev.point.y + t * (curr.point.y - prev.point.y);

  // Slerp-ish tangent (since both are already unit, lerp + normalise is fine
  // for the small angular steps produced by 1px sampling)
  const txRaw = prev.tx + t * (curr.tx - prev.tx);
  const tyRaw = prev.ty + t * (curr.ty - prev.ty);
  const tLen = Math.sqrt(txRaw * txRaw + tyRaw * tyRaw) || 1;

  return {
    distance: dist,
    point: { x, y },
    tx: txRaw / tLen,
    ty: tyRaw / tLen,
  };
}

/**
 * Place each character of `text` along the path described by `anchors`.
 *
 * `glyphWidths` is an array of advance widths, one entry per character in
 * `text` (in the same order). If the array is shorter than the text the
 * missing characters are each given a width of `fontSize * 0.6`.
 *
 * Characters that would fall beyond the end of the path are omitted from the
 * returned array (truncation, not wrapping).
 */
export function placeTextOnPath(
  text: string,
  glyphWidths: readonly number[],
  anchors: readonly PathAnchor[],
  closed: boolean,
  fontSize: number,
): GlyphPlacement[] {
  const table = buildPathLookupTable(anchors, closed);
  if (table.length === 0) return [];

  const placements: GlyphPlacement[] = [];
  let dist = 0;
  const fallbackWidth = fontSize * 0.6;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const advance = glyphWidths[i] ?? fallbackWidth;

    // Place glyph at dist + half its width so the character is centred over
    // the sample point (matches Canvas2D fillText behaviour).
    const centreDist = dist + advance / 2;
    const sample = sampleAtDistance(table, centreDist);

    if (sample === null) break; // beyond end of path — truncate

    placements.push({
      charIndex: i,
      char,
      x: sample.point.x,
      y: sample.point.y,
      rotation: Math.atan2(sample.ty, sample.tx),
    });

    dist += advance;
  }

  return placements;
}
