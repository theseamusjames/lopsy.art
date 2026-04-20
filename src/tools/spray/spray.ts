export interface SpraySettings {
  readonly size: number;
  readonly density: number;
  readonly opacity: number;
  readonly hardness: number;
}

export function defaultSpraySettings(): SpraySettings {
  return { size: 40, density: 20, opacity: 60, hardness: 30 };
}

export interface SprayDot {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly opacity: number;
}

export function generateSprayDots(
  centerX: number,
  centerY: number,
  brushRadius: number,
  density: number,
  baseOpacity: number,
): SprayDot[] {
  const dots: SprayDot[] = [];
  const count = Math.max(1, Math.round(density));
  const minDotRadius = Math.max(1, brushRadius * 0.02);
  const maxDotRadius = Math.max(2, brushRadius * 0.12);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * brushRadius;
    const x = centerX + Math.cos(angle) * dist;
    const y = centerY + Math.sin(angle) * dist;
    const radius = minDotRadius + Math.random() * (maxDotRadius - minDotRadius);
    const distFalloff = 1 - (dist / brushRadius) * 0.3;
    const opacity = baseOpacity * (0.4 + Math.random() * 0.6) * distFalloff;

    dots.push({ x, y, radius: Math.round(Math.max(1, radius)), opacity: Math.min(1, opacity) });
  }

  return dots;
}
