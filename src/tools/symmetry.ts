export interface SymmetryConfig {
  horizontal: boolean;
  vertical: boolean;
  radial: boolean;
  segments: number;
  centerX: number;
  centerY: number;
}

function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  cos: number,
  sin: number,
): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function getMirroredPoints(
  x: number,
  y: number,
  config: SymmetryConfig,
): Array<{ x: number; y: number }> {
  if (config.radial && config.segments > 1) {
    return getRadialPoints(x, y, config);
  }
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

function getRadialPoints(
  x: number,
  y: number,
  config: SymmetryConfig,
): Array<{ x: number; y: number }> {
  const { segments, centerX: cx, centerY: cy } = config;
  const result: Array<{ x: number; y: number }> = [];
  const step = (2 * Math.PI) / segments;
  for (let i = 1; i < segments; i++) {
    const angle = step * i;
    result.push(rotatePoint(x, y, cx, cy, Math.cos(angle), Math.sin(angle)));
  }
  return result;
}

export function mirrorBatchPoints(
  points: Float64Array,
  config: SymmetryConfig,
): Float64Array[] {
  if (config.radial && config.segments > 1) {
    return radialBatchPoints(points, config);
  }
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

function radialBatchPoints(
  points: Float64Array,
  config: SymmetryConfig,
): Float64Array[] {
  const { segments, centerX: cx, centerY: cy } = config;
  const results: Float64Array[] = [];
  const step = (2 * Math.PI) / segments;
  for (let i = 1; i < segments; i++) {
    const angle = step * i;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = new Float64Array(points.length);
    for (let j = 0; j < points.length; j += 2) {
      const dx = (points[j] as number) - cx;
      const dy = (points[j + 1] as number) - cy;
      rotated[j] = cx + dx * cos - dy * sin;
      rotated[j + 1] = cy + dx * sin + dy * cos;
    }
    results.push(rotated);
  }
  return results;
}

export function isSymmetryActive(config: SymmetryConfig): boolean {
  return config.horizontal || config.vertical || (config.radial && config.segments > 1);
}
