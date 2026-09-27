/** Hard cap on either document side, independent of the GPU. */
export const MAX_DOCUMENT_SIDE = 16384;

/**
 * Largest side a document (or layer) may have: the hard cap, lowered to the
 * GPU's `MAX_TEXTURE_SIZE` when that's smaller. Every layer is one texture,
 * so a document wider than the texture limit can't be allocated (#934).
 */
export function maxDocumentSide(gpuMaxTextureSize: number | null): number {
  if (gpuMaxTextureSize === null || gpuMaxTextureSize <= 0) return MAX_DOCUMENT_SIDE;
  return Math.min(MAX_DOCUMENT_SIDE, gpuMaxTextureSize);
}

/** Round and clamp a requested side length into `[1, maxSide]`. */
export function clampDocumentSide(px: number, maxSide: number): number {
  if (!Number.isFinite(px)) return 1;
  return Math.max(1, Math.min(maxSide, Math.round(px)));
}
