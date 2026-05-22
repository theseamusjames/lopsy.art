import type { BrushPreset, BrushTipData, BrushTextureData } from '../../types/brush';

let nextId = 1;
function uid(): string {
  return `brush-${nextId++}`;
}

function generateSquareTip(size: number): BrushTipData {
  const data = new Uint8ClampedArray(size * size);
  data.fill(255);
  return { width: size, height: size, data };
}

function generateCrossHatchTip(size: number): BrushTipData {
  const data = new Uint8ClampedArray(size * size);
  const lineWidth = Math.max(1, Math.round(size * 0.12));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d1 = Math.abs((x - y) % Math.round(size * 0.4));
      const d2 = Math.abs((x + y) % Math.round(size * 0.4));
      if (d1 < lineWidth || d2 < lineWidth) {
        data[y * size + x] = 255;
      }
    }
  }
  return { width: size, height: size, data };
}

function generateDiamondTip(size: number): BrushTipData {
  const data = new Uint8ClampedArray(size * size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - half + 0.5);
      const dy = Math.abs(y - half + 0.5);
      if (dx / half + dy / half <= 1.0) {
        data[y * size + x] = 255;
      }
    }
  }
  return { width: size, height: size, data };
}

function generateStarTip(size: number, points: number): BrushTipData {
  const data = new Uint8ClampedArray(size * size);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1;
  const innerR = outerR * 0.4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      const sector = (angle / Math.PI / 2 * points + points) % 1;
      const spoke = sector < 0.5 ? sector * 2 : (1 - sector) * 2;
      const maxR = innerR + (outerR - innerR) * spoke;

      if (dist <= maxR) {
        data[y * size + x] = 255;
      }
    }
  }
  return { width: size, height: size, data };
}

function generateSlashTip(width: number, height: number): BrushTipData {
  const data = new Uint8ClampedArray(width * height);
  const lineW = Math.max(1, Math.round(Math.min(width, height) * 0.2));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y / (height - 1);
      const cx = t * (width - 1);
      if (Math.abs(x - cx) < lineW) {
        data[y * width + x] = 255;
      }
    }
  }
  return { width, height, data };
}

function generateNoiseTip(size: number): BrushTipData {
  const data = new Uint8ClampedArray(size * size);
  const half = size / 2;
  let seed = 12345;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - half + 0.5;
      const dy = y - half + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > half) continue;
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      const r = ((seed >>> 0) / 0xFFFFFFFF);
      const falloff = 1.0 - dist / half;
      data[y * size + x] = Math.round(r * falloff * 255);
    }
  }
  return { width: size, height: size, data };
}

function generateLeafTip(size: number): BrushTipData {
  const data = new Uint8ClampedArray(size * size);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx + 0.5) / cx;
      const dy = (y - cy + 0.5) / cy;
      const ey = Math.abs(dy);
      const maxX = (1.0 - ey * ey) * 0.6;
      if (Math.abs(dx) < maxX) {
        const falloff = 1.0 - Math.abs(dy);
        data[y * size + x] = Math.round(falloff * 255);
      }
    }
  }
  return { width: size, height: size, data };
}

function tileHash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) & 0xFF) / 255;
}

function generateSeamlessNoise(size: number, octaves: number, seed: number): Float64Array {
  const data = new Float64Array(size * size);
  for (let oct = 0; oct < octaves; oct++) {
    const freq = 1 << oct;
    const amp = 1 / (1 << oct);
    const cellSize = size / freq;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cx = x / cellSize;
        const cy = y / cellSize;
        const x0 = Math.floor(cx) % freq;
        const y0 = Math.floor(cy) % freq;
        const x1 = (x0 + 1) % freq;
        const y1 = (y0 + 1) % freq;
        const fx = cx - Math.floor(cx);
        const fy = cy - Math.floor(cy);
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const v00 = tileHash(x0, y0, seed + oct * 997);
        const v10 = tileHash(x1, y0, seed + oct * 997);
        const v01 = tileHash(x0, y1, seed + oct * 997);
        const v11 = tileHash(x1, y1, seed + oct * 997);
        const v = (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
        const idx = y * size + x;
        data[idx] = (data[idx] ?? 0) + v * amp;
      }
    }
  }
  return data;
}

function generateNoiseTexture(size: number): BrushTextureData {
  const raw = generateSeamlessNoise(size, 4, 42);
  const data = new Uint8ClampedArray(size * size);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]! < min) min = raw[i]!;
    if (raw[i]! > max) max = raw[i]!;
  }
  const range = max - min || 1;
  for (let i = 0; i < raw.length; i++) {
    data[i] = Math.round(((raw[i]! - min) / range) * 255);
  }
  return { id: 'texture-noise', name: 'Noise', width: size, height: size, data };
}

function generateCanvasTexture(size: number): BrushTextureData {
  const raw = generateSeamlessNoise(size, 3, 100);
  const data = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = ((y % 4 < 2) ? 0.7 : 1.0) * ((x % 4 < 2) ? 0.7 : 1.0);
      const noise = raw[y * size + x]!;
      data[y * size + x] = Math.round((weave * 0.7 + noise * 0.3) * 255);
    }
  }
  return { id: 'texture-canvas', name: 'Canvas', width: size, height: size, data };
}

function generateGrainTexture(size: number): BrushTextureData {
  const raw = generateSeamlessNoise(size, 5, 7);
  const data = new Uint8ClampedArray(size * size);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i]! < min) min = raw[i]!;
    if (raw[i]! > max) max = raw[i]!;
  }
  const range = max - min || 1;
  for (let i = 0; i < raw.length; i++) {
    data[i] = Math.round(((raw[i]! - min) / range) * 60 + 195);
  }
  return { id: 'texture-grain', name: 'Grain', width: size, height: size, data };
}

export const BUILTIN_TEXTURES: BrushTextureData[] = [
  generateNoiseTexture(128),
  generateCanvasTexture(128),
  generateGrainTexture(128),
];

export const BUILTIN_PRESETS: BrushPreset[] = [
  {
    id: 'builtin-hard-round',
    name: 'Hard Round',
    tip: null,
    size: 10,
    hardness: 100,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: false,
  },
  {
    id: 'builtin-soft-round',
    name: 'Soft Round',
    tip: null,
    size: 20,
    hardness: 0,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: false,
  },
  {
    id: 'builtin-airbrush',
    name: 'Airbrush',
    tip: null,
    size: 40,
    hardness: 0,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 30,
    flow: 50,
    isCustom: false,
  },
  {
    id: 'builtin-square',
    name: 'Square',
    tip: generateSquareTip(32),
    size: 20,
    hardness: 100,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: false,
  },
  {
    id: 'builtin-crosshatch',
    name: 'Cross Hatch',
    tip: generateCrossHatchTip(48),
    size: 30,
    hardness: 100,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 80,
    isCustom: false,
  },
  {
    id: 'builtin-diamond',
    name: 'Diamond',
    tip: generateDiamondTip(32),
    size: 20,
    hardness: 100,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: false,
  },
  {
    id: 'builtin-star',
    name: 'Star',
    tip: generateStarTip(48, 5),
    size: 30,
    hardness: 100,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: false,
  },
  {
    id: 'builtin-slash',
    name: 'Slash',
    tip: generateSlashTip(8, 32),
    size: 20,
    hardness: 100,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: false,
  },
  {
    id: 'builtin-chalk',
    name: 'Chalk',
    tip: generateNoiseTip(32),
    size: 15,
    hardness: 100,
    spacing: 1,
    scatter: 20,
    angle: 0,
    opacity: 80,
    flow: 80,
    isCustom: false,
  },
  {
    id: 'builtin-spray',
    name: 'Spray',
    tip: generateNoiseTip(48),
    size: 25,
    hardness: 100,
    spacing: 1,
    scatter: 80,
    angle: 0,
    opacity: 50,
    flow: 40,
    isCustom: false,
  },
  {
    id: 'builtin-leaf',
    name: 'Leaf',
    tip: generateLeafTip(48),
    size: 30,
    hardness: 100,
    spacing: 1,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: false,
  },
];

export function createPresetId(): string {
  return uid();
}

export function abrBrushToPreset(
  name: string,
  tip: BrushTipData,
  spacing?: number,
): BrushPreset {
  return {
    id: uid(),
    name,
    tip,
    size: Math.max(tip.width, tip.height),
    hardness: 100,
    spacing: spacing ?? 0,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: true,
  };
}
