/**
 * Helpers for deciding whether an image pasted from the system clipboard is a
 * paste-back of content that was copied inside the app. Kept free of engine /
 * store imports so the pixel-matching logic stays pure and unit-testable.
 */

/** Decode an image blob to straight (non-premultiplied) RGBA bytes. */
export async function decodeBlobToRgba(
  blob: Blob,
): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    // No color-space conversion / premultiplication so the decoded bytes match
    // the raw GPU pixels the clipboard PNG was written from — otherwise a
    // wide-gamut (Display-P3) round-trip could shift RGB past the match
    // tolerance and drop a legitimate paste-back back to 0,0.
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } catch {
    return null;
  }
}

/**
 * Whether two equal-length RGBA buffers hold (near-)identical content.
 *
 * A system-clipboard round-trip can nudge RGB values under partial alpha
 * (canvas premultiplied-alpha decoding), so RGB is only compared where the
 * pixel is near-opaque and alpha is compared everywhere with a small
 * tolerance. Content is sampled — a few thousand pixels is plenty to tell our
 * own copy apart from an unrelated image of the same dimensions.
 */
export function pixelsLikelySame(
  a: Uint8Array | Uint8ClampedArray,
  b: Uint8Array | Uint8ClampedArray,
): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const pixelCount = a.length / 4;
  const step = Math.max(1, Math.floor(pixelCount / 4096));
  let checked = 0;
  let mismatches = 0;
  for (let p = 0; p < pixelCount; p += step) {
    const i = p * 4;
    checked++;
    const aAlpha = a[i + 3]!;
    const bAlpha = b[i + 3]!;
    if (Math.abs(aAlpha - bAlpha) > 4) {
      mismatches++;
      continue;
    }
    if (aAlpha > 250 && bAlpha > 250) {
      if (
        Math.abs(a[i]! - b[i]!) > 6 ||
        Math.abs(a[i + 1]! - b[i + 1]!) > 6 ||
        Math.abs(a[i + 2]! - b[i + 2]!) > 6
      ) {
        mismatches++;
      }
    }
  }
  return checked > 0 && mismatches / checked < 0.02;
}
