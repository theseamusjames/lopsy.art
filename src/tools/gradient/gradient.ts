import type { Color } from '../../types';

export interface GradientStop {
  readonly position: number;
  readonly color: Color;
}

export interface GradientSettings {
  readonly type: 'linear' | 'radial';
  readonly stops: readonly GradientStop[];
  readonly reverse: boolean;
}

export function defaultGradientSettings(): GradientSettings {
  return {
    type: 'linear',
    stops: [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ],
    reverse: false,
  };
}

export function interpolateGradient(stops: readonly GradientStop[], t: number): Color {
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 };
  if (stops.length === 1) return stops[0]!.color;

  const clamped = Math.max(0, Math.min(1, t));

  // Find the two stops to interpolate between
  let lower = stops[0]!;
  let upper = stops[stops.length - 1]!;

  for (let i = 0; i < stops.length - 1; i++) {
    const curr = stops[i]!;
    const next = stops[i + 1]!;
    if (clamped >= curr.position && clamped <= next.position) {
      lower = curr;
      upper = next;
      break;
    }
  }

  if (lower.position === upper.position) return lower.color;

  const localT = (clamped - lower.position) / (upper.position - lower.position);

  return {
    r: Math.round(lower.color.r + (upper.color.r - lower.color.r) * localT),
    g: Math.round(lower.color.g + (upper.color.g - lower.color.g) * localT),
    b: Math.round(lower.color.b + (upper.color.b - lower.color.b) * localT),
    a: lower.color.a + (upper.color.a - lower.color.a) * localT,
  };
}

export function computeLinearGradientT(
  px: number,
  py: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const dx = endX - startX;
  const dy = endY - startY;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;

  const t = ((px - startX) * dx + (py - startY) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

export function computeRadialGradientT(
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  radius: number,
): number {
  if (radius === 0) return 0;
  const dx = px - centerX;
  const dy = py - centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, Math.min(1, dist / radius));
}
