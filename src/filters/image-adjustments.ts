export interface ImageAdjustments {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vignette: number;
  saturation: number;
  vibrance: number;
}

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vignette: 0,
  saturation: 0,
  vibrance: 0,
};

export function aggregateGroupAdjustments(
  layers: readonly { type: string; visible: boolean; adjustments?: ImageAdjustments; adjustmentsEnabled?: boolean }[],
): ImageAdjustments | null {
  const agg: ImageAdjustments = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vignette: 0, saturation: 0, vibrance: 0 };
  let found = false;
  for (const l of layers) {
    if (l.type === 'group' && l.adjustments && l.adjustmentsEnabled !== false && l.visible) {
      agg.exposure += l.adjustments.exposure;
      agg.contrast += l.adjustments.contrast;
      agg.highlights += l.adjustments.highlights;
      agg.shadows += l.adjustments.shadows;
      agg.whites += l.adjustments.whites;
      agg.blacks += l.adjustments.blacks;
      agg.vignette += l.adjustments.vignette;
      agg.saturation += l.adjustments.saturation ?? 0;
      agg.vibrance += l.adjustments.vibrance ?? 0;
      found = true;
    }
  }
  return found ? agg : null;
}

export function hasActiveAdjustments(adj: ImageAdjustments): boolean {
  return (
    adj.exposure !== 0 ||
    adj.contrast !== 0 ||
    adj.highlights !== 0 ||
    adj.shadows !== 0 ||
    adj.whites !== 0 ||
    adj.blacks !== 0 ||
    adj.vignette !== 0 ||
    adj.saturation !== 0 ||
    adj.vibrance !== 0
  );
}

export function buildAdjustmentLUT(adj: ImageAdjustments): Uint8Array {
  const lut = new Uint8Array(256);
  const exposureMul = Math.pow(2, adj.exposure);
  const contrastFactor = adj.contrast / 100;
  const highlightsFactor = adj.highlights / 200;
  const shadowsFactor = adj.shadows / 200;
  const whitesFactor = adj.whites / 300;
  const blacksFactor = adj.blacks / 300;

  for (let i = 0; i < 256; i++) {
    let v = i / 255;

    // Exposure: multiply by 2^exposure (stops)
    v *= exposureMul;

    // Contrast: linear stretch around midpoint
    v = (v - 0.5) * (1 + contrastFactor) + 0.5;

    // Highlights: push bright tones
    if (adj.highlights !== 0) {
      const w = Math.max(0, (v - 0.5) * 2);
      v += highlightsFactor * w * w;
    }

    // Shadows: push dark tones
    if (adj.shadows !== 0) {
      const w = Math.max(0, (0.5 - v) * 2);
      v += shadowsFactor * w * w;
    }

    // Whites: shift the bright end
    if (adj.whites !== 0) {
      const w = v * v;
      v += whitesFactor * w;
    }

    // Blacks: shift the dark end
    if (adj.blacks !== 0) {
      const w = (1 - v) * (1 - v);
      v += blacksFactor * w;
    }

    lut[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  return lut;
}

function applyVignette(imageData: ImageData, strength: number): void {
  const { width, height, data } = imageData;
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      const factor = 1 - dist * dist * (strength / 100);
      const idx = (y * width + x) * 4;
      data[idx] = Math.max(0, Math.round(data[idx]! * factor));
      data[idx + 1] = Math.max(0, Math.round(data[idx + 1]! * factor));
      data[idx + 2] = Math.max(0, Math.round(data[idx + 2]! * factor));
    }
  }
}

export function applyAdjustmentsToImageData(
  imageData: ImageData,
  adj: ImageAdjustments,
): void {
  const hasLUT =
    adj.exposure !== 0 ||
    adj.contrast !== 0 ||
    adj.highlights !== 0 ||
    adj.shadows !== 0 ||
    adj.whites !== 0 ||
    adj.blacks !== 0;

  if (hasLUT) {
    const lut = buildAdjustmentLUT(adj);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]!]!;
      data[i + 1] = lut[data[i + 1]!]!;
      data[i + 2] = lut[data[i + 2]!]!;
    }
  }

  if (adj.vignette !== 0) {
    applyVignette(imageData, adj.vignette);
  }
}
