export interface SymmetryConfig {
  horizontal: boolean;
  vertical: boolean;
  centerX: number;
  centerY: number;
  radialSegments: number;
}

export function getMirroredPoints(
  x: number,
  y: number,
  config: SymmetryConfig,
): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];

  if (config.radialSegments >= 2) {
    const dx = x - config.centerX;
    const dy = y - config.centerY;
    const n = config.radialSegments;
    for (let k = 1; k < n; k++) {
      const angle = (2 * Math.PI * k) / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      result.push({
        x: config.centerX + dx * cos - dy * sin,
        y: config.centerY + dx * sin + dy * cos,
      });
    }
    return result;
  }

  if (config.vertical) {
    result.push({ x: 2 * config.centerX - x, y });
  }
  if (config.horizontal) {
    result.push({ x, y: 2 * config.centerY - y });
  }
  if (config.vertical && config.horizontal) {
    result.push({ x: 2 * config.centerX - x, y: 2 * config.centerY - y });
  }
  return result;
}

export function mirrorBatchPoints(
  points: Float64Array,
  config: SymmetryConfig,
): Float64Array[] {
  const results: Float64Array[] = [];

  if (config.radialSegments >= 2) {
    const n = config.radialSegments;
    for (let k = 1; k < n; k++) {
      const angle = (2 * Math.PI * k) / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotated = new Float64Array(points.length);
      for (let i = 0; i < points.length; i += 2) {
        const dx = (points[i] as number) - config.centerX;
        const dy = (points[i + 1] as number) - config.centerY;
        rotated[i] = config.centerX + dx * cos - dy * sin;
        rotated[i + 1] = config.centerY + dx * sin + dy * cos;
      }
      results.push(rotated);
    }
    return results;
  }

  if (config.vertical) {
    const mirrored = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      mirrored[i] = 2 * config.centerX - (points[i] as number);
      mirrored[i + 1] = points[i + 1] as number;
    }
    results.push(mirrored);
  }
  if (config.horizontal) {
    const mirrored = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      mirrored[i] = points[i] as number;
      mirrored[i + 1] = 2 * config.centerY - (points[i + 1] as number);
    }
    results.push(mirrored);
  }
  if (config.vertical && config.horizontal) {
    const mirrored = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      mirrored[i] = 2 * config.centerX - (points[i] as number);
      mirrored[i + 1] = 2 * config.centerY - (points[i + 1] as number);
    }
    results.push(mirrored);
  }
  return results;
}

/**
 * Row-major 2x2 linear map `[[m00, m01], [m10, m11]]`. For a symmetry copy
 * it is the part of the copy's transform about the centre that acts on
 * directions, so it also says how the copy's tip must be oriented.
 */
export interface SymmetryMatrix {
  readonly m00: number;
  readonly m01: number;
  readonly m10: number;
  readonly m11: number;
}

/**
 * The linear part of each symmetry copy, in the same order as
 * `getMirroredPoints` / `mirrorBatchPoints` return the copies. A mirror
 * across the vertical axis is `x → -x` (a flip, not a rotation), the 4-way
 * diagonal copy is a 180° turn, and radial copy k rotates by k·360°/n.
 */
export function getSymmetryMatrices(config: SymmetryConfig): SymmetryMatrix[] {
  const result: SymmetryMatrix[] = [];
  if (config.radialSegments >= 2) {
    const n = config.radialSegments;
    for (let k = 1; k < n; k++) {
      const angle = (2 * Math.PI * k) / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      result.push({ m00: cos, m01: -sin, m10: sin, m11: cos });
    }
    return result;
  }
  if (config.vertical) result.push({ m00: -1, m01: 0, m10: 0, m11: 1 });
  if (config.horizontal) result.push({ m00: 1, m01: 0, m10: 0, m11: -1 });
  if (config.vertical && config.horizontal) result.push({ m00: -1, m01: 0, m10: 0, m11: -1 });
  return result;
}

/**
 * The map a copy's dab applies to its pixel offsets to find the tip texel
 * it samples: the inverse of the copy's linear part. Every symmetry matrix
 * is orthogonal (a rotation or a reflection), so the inverse is the
 * transpose.
 */
export function dabSampleMatrix(copy: SymmetryMatrix): SymmetryMatrix {
  return { m00: copy.m00, m01: copy.m10, m10: copy.m01, m11: copy.m11 };
}

export function isSymmetryActive(config: SymmetryConfig): boolean {
  return config.horizontal || config.vertical || config.radialSegments >= 2;
}
