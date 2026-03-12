import type { Color, BlendMode } from '../types/index';

type BlendFn = (src: number, dst: number) => number;

function blendNormal(src: number, _dst: number): number {
  return src;
}

function blendMultiply(src: number, dst: number): number {
  return (src * dst) / 255;
}

function blendScreen(src: number, dst: number): number {
  return 255 - ((255 - src) * (255 - dst)) / 255;
}

function blendOverlay(src: number, dst: number): number {
  return dst < 128
    ? (2 * src * dst) / 255
    : 255 - (2 * (255 - src) * (255 - dst)) / 255;
}

function blendDarken(src: number, dst: number): number {
  return Math.min(src, dst);
}

function blendLighten(src: number, dst: number): number {
  return Math.max(src, dst);
}

function blendDifference(src: number, dst: number): number {
  return Math.abs(src - dst);
}

const BLEND_FNS: Record<string, BlendFn> = {
  normal: blendNormal,
  multiply: blendMultiply,
  screen: blendScreen,
  overlay: blendOverlay,
  darken: blendDarken,
  lighten: blendLighten,
  difference: blendDifference,
};

export function blendColors(src: Color, dst: Color, mode: BlendMode): Color {
  const fn = BLEND_FNS[mode];
  if (!fn) {
    // Unsupported blend modes fall back to normal
    return blendColors(src, dst, 'normal');
  }

  const srcA = src.a;
  const dstA = dst.a;

  // Source is fully transparent — destination unchanged
  if (srcA === 0) {
    return dst;
  }

  // Destination is fully transparent — source color with source alpha
  if (dstA === 0) {
    return { r: src.r, g: src.g, b: src.b, a: srcA };
  }

  // Apply blend function per channel
  const blendedR = fn(src.r, dst.r);
  const blendedG = fn(src.g, dst.g);
  const blendedB = fn(src.b, dst.b);

  // Porter-Duff "source over" compositing
  const outA = srcA + dstA * (1 - srcA);

  if (outA === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const outR = Math.round((blendedR * srcA + dst.r * dstA * (1 - srcA)) / outA);
  const outG = Math.round((blendedG * srcA + dst.g * dstA * (1 - srcA)) / outA);
  const outB = Math.round((blendedB * srcA + dst.b * dstA * (1 - srcA)) / outA);

  return {
    r: Math.min(255, Math.max(0, outR)),
    g: Math.min(255, Math.max(0, outG)),
    b: Math.min(255, Math.max(0, outB)),
    a: Math.min(1, outA),
  };
}
