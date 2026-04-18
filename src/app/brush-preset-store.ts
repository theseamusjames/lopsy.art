import { create } from 'zustand';
import type { BrushPreset, BrushTipData } from '../types/brush';
import { useToolSettingsStore } from './tool-settings-store';
import { useUIStore } from './ui-store';

interface BrushPresetState {
  presets: BrushPreset[];
  activePresetId: string | null;

  addPreset: (preset: BrushPreset) => void;
  addPresets: (presets: BrushPreset[]) => void;
  removePreset: (id: string) => void;
  updatePreset: (id: string, patch: Partial<Omit<BrushPreset, 'id'>>) => void;
  setActivePreset: (id: string) => void;
  /**
   * Back-compat wrapper that delegates to the ui-store modal slot. The
   * boolean used to live on this store; callers (including e2e tests via
   * `__brushPresetStore`) keep working unchanged.
   */
  setShowBrushModal: (show: boolean) => void;
}

let nextId = 1;
function uid(): string {
  return `brush-${nextId++}`;
}

// ---------------------------------------------------------------------------
// Tip generators — create grayscale Uint8ClampedArray bitmaps at init time
// ---------------------------------------------------------------------------

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
      // Diagonal lines: y = x + offset, y = -x + offset
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
      // xorshift for deterministic noise
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
      // Leaf shape: ellipse pinched at the ends
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

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

const BUILTIN_PRESETS: BrushPreset[] = [
  {
    id: 'builtin-hard-round',
    name: 'Hard Round',
    tip: null,
    size: 10,
    hardness: 100,
    spacing: 0,
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
    spacing: 0,
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
    spacing: 15,
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
    spacing: 0,
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
    spacing: 50,
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
    spacing: 0,
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
    spacing: 80,
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
    spacing: 0,
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
    spacing: 30,
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
    spacing: 60,
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
    spacing: 0,
    scatter: 0,
    angle: 0,
    opacity: 100,
    flow: 100,
    isCustom: false,
  },
];

function syncToToolSettings(preset: BrushPreset): void {
  const ts = useToolSettingsStore.getState();
  ts.setBrushSize(preset.size);
  ts.setBrushHardness(preset.hardness);
  ts.setBrushOpacity(preset.opacity);
  ts.setBrushSpacing(preset.spacing);
  ts.setBrushScatter(preset.scatter);
  ts.setBrushAngle(preset.angle);
  ts.setActiveBrushTip(preset.tip);
}

export const useBrushPresetStore = create<BrushPresetState>((set, get) => ({
  presets: BUILTIN_PRESETS,
  activePresetId: 'builtin-hard-round',

  addPreset: (preset) => set((s) => ({ presets: [...s.presets, preset] })),

  addPresets: (presets) => set((s) => ({ presets: [...s.presets, ...presets] })),

  removePreset: (id) =>
    set((s) => ({
      presets: s.presets.filter((p) => p.id !== id),
      activePresetId: s.activePresetId === id ? null : s.activePresetId,
    })),

  updatePreset: (id, patch) =>
    set((s) => ({
      presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  setActivePreset: (id) => {
    const preset = get().presets.find((p) => p.id === id);
    if (!preset) return;
    set({ activePresetId: id });
    syncToToolSettings(preset);
  },

  setShowBrushModal: (show) => useUIStore.getState().setShowBrushModal(show),
}));

/** Create a unique id for a new custom preset. */
export function createPresetId(): string {
  return uid();
}

/** Convert imported ABR brush data into a BrushPreset. */
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
