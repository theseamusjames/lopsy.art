import type { BrushTipData } from '../../types/brush';

interface SelectionInfo {
  bounds: { x: number; y: number; width: number; height: number };
  mask: Uint8ClampedArray;
  maskWidth: number;
  maskHeight: number;
}

/**
 * Create a custom brush tip from the selected region of an image.
 *
 * Converts the image to grayscale, multiplies by the selection mask,
 * then inverts so dark image areas produce opaque brush strokes
 * (matching Photoshop's "Define Brush Preset" convention).
 */
export function createBrushTipFromSelection(
  imageData: ImageData,
  selection: SelectionInfo,
): BrushTipData {
  const { bounds, mask, maskWidth, maskHeight } = selection;
  const imgW = imageData.width;
  const imgH = imageData.height;
  const pixels = imageData.data;

  // Clamp bounds to imageData extents
  const x0 = Math.max(0, bounds.x);
  const y0 = Math.max(0, bounds.y);
  const x1 = Math.min(imgW, bounds.x + bounds.width);
  const y1 = Math.min(imgH, bounds.y + bounds.height);

  const regionW = x1 - x0;
  const regionH = y1 - y0;

  if (regionW <= 0 || regionH <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray([255]) };
  }

  const raw = new Uint8ClampedArray(regionW * regionH);

  for (let row = 0; row < regionH; row++) {
    for (let col = 0; col < regionW; col++) {
      const imgX = x0 + col;
      const imgY = y0 + row;
      const imgIdx = (imgY * imgW + imgX) * 4;

      const r = pixels[imgIdx] ?? 0;
      const g = pixels[imgIdx + 1] ?? 0;
      const b = pixels[imgIdx + 2] ?? 0;
      const a = pixels[imgIdx + 3] ?? 0;

      // Transparent pixels produce 0 grayscale (will invert to 0 = no paint)
      let gray = 0;
      if (a > 0) {
        gray = 0.299 * r + 0.587 * g + 0.114 * b;
      }

      // Sample the selection mask at the corresponding position
      const maskX = imgX;
      const maskY = imgY;
      let maskVal = 1;
      if (maskX >= 0 && maskX < maskWidth && maskY >= 0 && maskY < maskHeight) {
        maskVal = (mask[maskY * maskWidth + maskX] ?? 0) / 255;
      } else {
        maskVal = 0;
      }

      // Invert: dark image areas → opaque brush, white → transparent
      const value = Math.round((255 - gray) * maskVal);
      raw[row * regionW + col] = value;
    }
  }

  // Crop to content bounds (trim rows/columns that are all 0)
  let cropTop = 0;
  let cropBottom = regionH - 1;
  let cropLeft = 0;
  let cropRight = regionW - 1;

  // Top
  outer_top: for (let row = 0; row < regionH; row++) {
    for (let col = 0; col < regionW; col++) {
      if ((raw[row * regionW + col] ?? 0) > 0) break outer_top;
    }
    cropTop = row + 1;
  }

  // Bottom
  outer_bottom: for (let row = regionH - 1; row >= cropTop; row--) {
    for (let col = 0; col < regionW; col++) {
      if ((raw[row * regionW + col] ?? 0) > 0) break outer_bottom;
    }
    cropBottom = row - 1;
  }

  // Left
  outer_left: for (let col = 0; col < regionW; col++) {
    for (let row = cropTop; row <= cropBottom; row++) {
      if ((raw[row * regionW + col] ?? 0) > 0) break outer_left;
    }
    cropLeft = col + 1;
  }

  // Right
  outer_right: for (let col = regionW - 1; col >= cropLeft; col--) {
    for (let row = cropTop; row <= cropBottom; row++) {
      if ((raw[row * regionW + col] ?? 0) > 0) break outer_right;
    }
    cropRight = col - 1;
  }

  const croppedW = cropRight - cropLeft + 1;
  const croppedH = cropBottom - cropTop + 1;

  if (croppedW <= 0 || croppedH <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray([255]) };
  }

  const cropped = new Uint8ClampedArray(croppedW * croppedH);
  for (let row = 0; row < croppedH; row++) {
    const srcOffset = (row + cropTop) * regionW + cropLeft;
    const dstOffset = row * croppedW;
    cropped.set(raw.subarray(srcOffset, srcOffset + croppedW), dstOffset);
  }

  return { width: croppedW, height: croppedH, data: cropped };
}
