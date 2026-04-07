export interface SymmetryConfig {
  horizontal: boolean;
  vertical: boolean;
  centerX: number;
  centerY: number;
}

export function getMirroredPoints(
  x: number,
  y: number,
  config: SymmetryConfig,
): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
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

export function isSymmetryActive(config: SymmetryConfig): boolean {
  return config.horizontal || config.vertical;
}
