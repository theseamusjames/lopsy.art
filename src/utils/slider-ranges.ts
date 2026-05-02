const PIXEL_SIZE_CEILING = 5000;
const PIXEL_SIZE_DOC_SCALE = 1.5;

export function docScaledMax(
  docWidth: number,
  docHeight: number,
  baseMax: number,
): number {
  const scaled = Math.round(PIXEL_SIZE_DOC_SCALE * Math.max(docWidth, docHeight));
  return Math.max(baseMax, Math.min(PIXEL_SIZE_CEILING, scaled));
}

export function docScaledOffset(
  docWidth: number,
  docHeight: number,
  baseAbs: number,
): number {
  const scaled = Math.round(PIXEL_SIZE_DOC_SCALE * Math.max(docWidth, docHeight));
  return Math.max(baseAbs, Math.min(PIXEL_SIZE_CEILING, scaled));
}
