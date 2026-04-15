import type { Point, PixelSurface } from '../../types';

/**
 * Apply a single smudge dab.
 *
 * Pushes pixels along the direction of motion (`prev` → `center`) by, for
 * each pixel within the brush radius, blending toward the color found at
 * `pixel − (center − prev)` — i.e. the color that was under the brush one
 * dab earlier. `strength` (0–1) controls how much each pixel is pulled; at
 * 1 the brush fully replaces with the "pulled" color, at 0 nothing changes.
 *
 * A soft-circle falloff (linear in radius) is applied so the centre of the
 * dab smudges hardest and the edge tapers to zero.
 *
 * This is the CPU reference implementation used by unit tests and by mask
 * edit mode. The live render path uses the GPU shader in
 * `engine-rs/crates/lopsy-wasm/src/gpu/shaders/brush/smudge_dab.glsl`.
 */
export function applySmudgeDab(
  surface: PixelSurface,
  prev: Point,
  center: Point,
  size: number,
  strength: number,
): void {
  const radius = Math.floor(size / 2);
  if (radius <= 0 || strength <= 0) return;

  const cx = Math.round(center.x);
  const cy = Math.round(center.y);
  const dx = center.x - prev.x;
  const dy = center.y - prev.y;

  // Read the region once up-front — without a snapshot, successive pixels in
  // the same dab would sample already-smudged neighbours and the whole dab
  // would wash out into a blur.
  const snapshotDiameter = radius * 2 + 1;
  const snapshot = new Array<{ r: number; g: number; b: number; a: number }>(
    snapshotDiameter * snapshotDiameter,
  );
  const sampleRange = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))) + 1;
  const snapshotPadding = radius + sampleRange;
  const paddedDiameter = snapshotPadding * 2 + 1;
  const padded = new Array<{ r: number; g: number; b: number; a: number }>(
    paddedDiameter * paddedDiameter,
  );
  for (let oy = -snapshotPadding; oy <= snapshotPadding; oy++) {
    for (let ox = -snapshotPadding; ox <= snapshotPadding; ox++) {
      const idx = (oy + snapshotPadding) * paddedDiameter + (ox + snapshotPadding);
      padded[idx] = surface.getPixel(cx + ox, cy + oy);
    }
  }

  // Copy the inner region from padded to snapshot (for the dab pixels proper).
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      const pIdx = (oy + snapshotPadding) * paddedDiameter + (ox + snapshotPadding);
      const sIdx = (oy + radius) * snapshotDiameter + (ox + radius);
      snapshot[sIdx] = padded[pIdx]!;
    }
  }

  const radiusSq = radius * radius;
  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      const distSq = ox * ox + oy * oy;
      if (distSq > radiusSq) continue;

      const dist = Math.sqrt(distSq);
      const falloff = 1 - dist / radius;
      const t = Math.min(1, Math.max(0, falloff * strength));
      if (t <= 0) continue;

      const existingIdx = (oy + radius) * snapshotDiameter + (ox + radius);
      const existing = snapshot[existingIdx]!;

      // Sample the "pulled" color: where this pixel was before the brush
      // moved from prev → center. Use the padded snapshot so sampling stays
      // consistent even across the stroke's direction.
      const sx = ox - dx;
      const sy = oy - dy;
      const psx = Math.round(sx) + snapshotPadding;
      const psy = Math.round(sy) + snapshotPadding;
      let sampled: { r: number; g: number; b: number; a: number };
      if (psx < 0 || psx >= paddedDiameter || psy < 0 || psy >= paddedDiameter) {
        sampled = surface.getPixel(cx + Math.round(sx), cy + Math.round(sy));
      } else {
        sampled = padded[psy * paddedDiameter + psx]!;
      }

      surface.setPixel(cx + ox, cy + oy, {
        r: Math.round(existing.r + (sampled.r - existing.r) * t),
        g: Math.round(existing.g + (sampled.g - existing.g) * t),
        b: Math.round(existing.b + (sampled.b - existing.b) * t),
        a: existing.a + (sampled.a - existing.a) * t,
      });
    }
  }
}
