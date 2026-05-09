import { getBuiltinBrushTip, listBuiltinBrushTips } from '../../engine-wasm/wasm-bridge';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import type { BrushTipData, BrushPreset } from '../../types/brush';

async function decodePngToGrayscale(pngBytes: Uint8Array): Promise<BrushTipData> {
  const blob = new Blob([pngBytes.buffer as ArrayBuffer], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, w, h);
  const grayscale = new Uint8ClampedArray(w * h);
  for (let i = 0; i < grayscale.length; i++) {
    const r = imageData.data[i * 4]!;
    const g = imageData.data[i * 4 + 1]!;
    const b = imageData.data[i * 4 + 2]!;
    const a = imageData.data[i * 4 + 3]!;
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    grayscale[i] = Math.round((255 - lum) * (a / 255));
  }
  return { width: w, height: h, data: grayscale };
}

function prettyName(stem: string): string {
  return stem
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

let loaded = false;

export async function loadBuiltinBitmapBrushes(): Promise<void> {
  if (loaded) return;
  loaded = true;

  const csv = listBuiltinBrushTips();
  const names = csv.split(',').filter(Boolean);
  if (names.length === 0) return;

  const presets: BrushPreset[] = [];
  for (const name of names) {
    const pngBytes = getBuiltinBrushTip(name);
    if (!pngBytes) continue;
    const tip = await decodePngToGrayscale(new Uint8Array(pngBytes));
    presets.push({
      id: `builtin-bitmap-${name}`,
      name: prettyName(name),
      tip,
      size: 30,
      hardness: 100,
      spacing: 15,
      scatter: 0,
      angle: 0,
      opacity: 100,
      flow: 100,
      isCustom: false,
    });
  }

  if (presets.length > 0) {
    useToolSettingsStore.getState().addPresets(presets);
  }
}
