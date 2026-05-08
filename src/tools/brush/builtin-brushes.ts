import { getBuiltinBrushTip } from '../../engine-wasm/wasm-bridge';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import type { BrushTipData, BrushPreset } from '../../types/brush';

interface BuiltinBrushDef {
  name: string;
  wasmKey: string;
  size: number;
  hardness: number;
  spacing: number;
  scatter: number;
  angle: number;
  opacity: number;
  flow: number;
}

const BUILTIN_BITMAP_BRUSHES: BuiltinBrushDef[] = [
  {
    name: 'Oblong',
    wasmKey: 'oblong',
    size: 30,
    hardness: 100,
    spacing: 15,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
  },
];

async function decodePngToGrayscale(pngBytes: Uint8Array): Promise<BrushTipData> {
  const blob = new Blob([pngBytes.buffer as ArrayBuffer], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const grayscale = new Uint8ClampedArray(bitmap.width * bitmap.height);
  for (let i = 0; i < grayscale.length; i++) {
    const r = imageData.data[i * 4]!;
    const g = imageData.data[i * 4 + 1]!;
    const b = imageData.data[i * 4 + 2]!;
    const a = imageData.data[i * 4 + 3]!;
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    grayscale[i] = Math.round((255 - lum) * (a / 255));
  }
  bitmap.close();
  return { width: bitmap.width, height: bitmap.height, data: grayscale };
}

let loaded = false;

export async function loadBuiltinBitmapBrushes(): Promise<void> {
  if (loaded) return;
  loaded = true;

  const presets: BrushPreset[] = [];
  for (const def of BUILTIN_BITMAP_BRUSHES) {
    const pngBytes = getBuiltinBrushTip(def.wasmKey);
    if (!pngBytes) continue;
    const tip = await decodePngToGrayscale(new Uint8Array(pngBytes));
    presets.push({
      id: `builtin-bitmap-${def.wasmKey}`,
      name: def.name,
      tip,
      size: def.size,
      hardness: def.hardness,
      spacing: def.spacing,
      scatter: def.scatter,
      angle: def.angle,
      opacity: def.opacity,
      flow: def.flow,
      isCustom: false,
    });
  }

  if (presets.length > 0) {
    useToolSettingsStore.getState().addPresets(presets);
  }
}
