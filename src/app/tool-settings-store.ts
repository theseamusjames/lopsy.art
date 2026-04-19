import { create } from 'zustand';
import type { Color, FontStyle, TextAlign } from '../types';
import type { GradientStop, GradientType } from '../tools/gradient/gradient';
import type { ShapeMode, ShapeOutput } from '../tools/shape/shape';
import type { DodgeMode } from '../tools/dodge/dodge';
import type { BrushPreset, BrushTipData } from '../types/brush';
import { colorEquals } from '../utils/color';

const MAX_RECENT_COLORS = 20;

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

interface ToolSettings {
  brushSize: number;
  brushOpacity: number;
  brushHardness: number;
  pencilSize: number;
  eraserSize: number;
  eraserOpacity: number;
  fillTolerance: number;
  fillContiguous: boolean;
  shapeMode: ShapeMode;
  shapeOutput: ShapeOutput;
  shapeFillColor: Color | null;
  shapeStrokeColor: Color | null;
  shapeStrokeWidth: number;
  shapePolygonSides: number;
  shapeCornerRadius: number;
  aspectRatioW: number;
  aspectRatioH: number;
  aspectRatioLocked: boolean;
  gradientType: GradientType;
  gradientStops: readonly GradientStop[];
  gradientReverse: boolean;
  stampSize: number;
  pathStrokeWidth: number;
  dodgeExposure: number;
  dodgeMode: DodgeMode;
  smudgeSize: number;
  smudgeStrength: number;
  wandTolerance: number;
  wandContiguous: boolean;
  magneticLassoWidth: number;
  magneticLassoContrast: number;
  magneticLassoFrequency: number;
  textContent: string;
  textFontSize: number;
  textFontFamily: string;
  textFontWeight: number;
  textFontStyle: FontStyle;
  textAlign: TextAlign;
  brushSpacing: number;
  brushScatter: number;
  brushAngle: number;
  brushFade: number;
  activeBrushTip: BrushTipData | null;
  symmetryHorizontal: boolean;
  symmetryVertical: boolean;
  foregroundColor: Color;
  backgroundColor: Color;
  recentColors: readonly Color[];
  presets: BrushPreset[];
  activePresetId: string | null;

  setBrushSize: (size: number) => void;
  setBrushFade: (fade: number) => void;
  setBrushSpacing: (spacing: number) => void;
  setBrushScatter: (scatter: number) => void;
  setBrushAngle: (angle: number) => void;
  setActiveBrushTip: (tip: BrushTipData | null) => void;
  setStampSize: (size: number) => void;
  setPathStrokeWidth: (width: number) => void;
  setDodgeExposure: (exposure: number) => void;
  setDodgeMode: (mode: DodgeMode) => void;
  setSmudgeSize: (size: number) => void;
  setSmudgeStrength: (strength: number) => void;
  setWandTolerance: (tolerance: number) => void;
  setWandContiguous: (contiguous: boolean) => void;
  setMagneticLassoWidth: (width: number) => void;
  setMagneticLassoContrast: (contrast: number) => void;
  setMagneticLassoFrequency: (frequency: number) => void;
  setTextContent: (content: string) => void;
  setTextFontSize: (size: number) => void;
  setTextFontFamily: (family: string) => void;
  setTextFontWeight: (weight: number) => void;
  setTextFontStyle: (style: FontStyle) => void;
  setTextAlign: (align: TextAlign) => void;
  setBrushOpacity: (opacity: number) => void;
  setBrushHardness: (hardness: number) => void;
  setPencilSize: (size: number) => void;
  setEraserSize: (size: number) => void;
  setEraserOpacity: (opacity: number) => void;
  setFillTolerance: (tolerance: number) => void;
  setFillContiguous: (contiguous: boolean) => void;
  setShapeMode: (mode: ShapeMode) => void;
  setShapeOutput: (output: ShapeOutput) => void;
  setShapeFillColor: (color: Color | null) => void;
  setShapeStrokeColor: (color: Color | null) => void;
  setShapeStrokeWidth: (width: number) => void;
  setShapePolygonSides: (sides: number) => void;
  setShapeCornerRadius: (radius: number) => void;
  setAspectRatioW: (w: number) => void;
  setAspectRatioH: (h: number) => void;
  setAspectRatioLocked: (locked: boolean) => void;
  setGradientType: (type: 'linear' | 'radial') => void;
  setGradientStops: (stops: readonly GradientStop[]) => void;
  setGradientReverse: (reverse: boolean) => void;
  addGradientStop: (position: number, color: Color) => void;
  removeGradientStop: (index: number) => void;
  updateGradientStop: (index: number, stop: Partial<GradientStop>) => void;
  setSymmetryHorizontal: (enabled: boolean) => void;
  setSymmetryVertical: (enabled: boolean) => void;
  setForegroundColor: (color: Color) => void;
  setBackgroundColor: (color: Color) => void;
  swapColors: () => void;
  resetColors: () => void;
  addRecentColor: (color: Color) => void;
  addPreset: (preset: BrushPreset) => void;
  addPresets: (presets: BrushPreset[]) => void;
  removePreset: (id: string) => void;
  updatePreset: (id: string, patch: Partial<Omit<BrushPreset, 'id'>>) => void;
  setActivePreset: (id: string) => void;
}

export const useToolSettingsStore = create<ToolSettings>((set, get) => ({
  brushSize: 10,
  brushOpacity: 100,
  brushHardness: 80,
  pencilSize: 1,
  eraserSize: 10,
  eraserOpacity: 100,
  fillTolerance: 32,
  fillContiguous: true,
  shapeMode: 'ellipse',
  shapeOutput: 'pixels' as const,
  shapeFillColor: { r: 255, g: 255, b: 255, a: 1 },
  shapeStrokeColor: null,
  shapeStrokeWidth: 2,
  shapePolygonSides: 6,
  shapeCornerRadius: 0,
  aspectRatioW: 1,
  aspectRatioH: 1,
  aspectRatioLocked: false,
  gradientType: 'linear',
  gradientStops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
  ],
  gradientReverse: false,
  stampSize: 20,
  pathStrokeWidth: 2,
  dodgeExposure: 50,
  dodgeMode: 'dodge',
  smudgeSize: 30,
  smudgeStrength: 50,
  wandTolerance: 32,
  wandContiguous: true,
  magneticLassoWidth: 10,
  magneticLassoContrast: 40,
  magneticLassoFrequency: 40,
  textContent: 'Text',
  textFontSize: 24,
  textFontFamily: 'sans-serif',
  textFontWeight: 400,
  textFontStyle: 'normal' as const,
  textAlign: 'left' as const,
  brushSpacing: 0,
  brushScatter: 0,
  brushAngle: 0,
  brushFade: 0,
  activeBrushTip: null,
  symmetryHorizontal: false,
  symmetryVertical: false,
  foregroundColor: { r: 0, g: 0, b: 0, a: 1 },
  backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  recentColors: Array.from({ length: MAX_RECENT_COLORS }, () => ({ r: 46, g: 46, b: 46, a: 1 })),
  presets: BUILTIN_PRESETS,
  activePresetId: 'builtin-hard-round',

  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(2000, size)) }),
  setBrushFade: (fade) => set({ brushFade: Math.max(0, Math.min(2000, fade)) }),
  setBrushSpacing: (spacing) => set({ brushSpacing: Math.max(0, Math.min(200, spacing)) }),
  setBrushScatter: (scatter) => set({ brushScatter: Math.max(0, Math.min(100, scatter)) }),
  setBrushAngle: (angle) => set({ brushAngle: ((angle % 360) + 360) % 360 }),
  setActiveBrushTip: (tip) => set({ activeBrushTip: tip }),
  setBrushOpacity: (opacity) => set({ brushOpacity: Math.max(1, Math.min(100, opacity)) }),
  setBrushHardness: (hardness) => set({ brushHardness: Math.max(0, Math.min(100, hardness)) }),
  setPencilSize: (size) => set({ pencilSize: Math.max(1, Math.min(100, size)) }),
  setEraserSize: (size) => set({ eraserSize: Math.max(1, Math.min(200, size)) }),
  setEraserOpacity: (opacity) => set({ eraserOpacity: Math.max(1, Math.min(100, opacity)) }),
  setFillTolerance: (tolerance) => set({ fillTolerance: Math.max(0, Math.min(255, tolerance)) }),
  setFillContiguous: (contiguous) => set({ fillContiguous: contiguous }),
  setShapeMode: (mode) => set({ shapeMode: mode }),
  setShapeOutput: (output) => set({ shapeOutput: output }),
  setShapeFillColor: (color) => set({ shapeFillColor: color }),
  setShapeStrokeColor: (color) => set({ shapeStrokeColor: color }),
  setShapeStrokeWidth: (width) => set({ shapeStrokeWidth: Math.max(1, Math.min(50, width)) }),
  setShapePolygonSides: (sides) => set({ shapePolygonSides: Math.max(3, Math.min(64, Math.round(sides))) }),
  setShapeCornerRadius: (radius) => set({ shapeCornerRadius: Math.max(0, Math.min(200, radius)) }),
  setAspectRatioW: (w) => set({ aspectRatioW: Math.max(0.01, w) }),
  setAspectRatioH: (h) => set({ aspectRatioH: Math.max(0.01, h) }),
  setAspectRatioLocked: (locked) => set({ aspectRatioLocked: locked }),
  setGradientType: (type) => set({ gradientType: type }),
  setGradientStops: (stops) => {
    const clamped = stops.length < 2
      ? [...stops, ...Array.from({ length: 2 - stops.length }, (_, i) => ({ position: i, color: { r: 0, g: 0, b: 0, a: 1 } }))]
      : stops.slice(0, 16);
    const sorted = [...clamped].sort((a, b) => a.position - b.position);
    set({ gradientStops: sorted });
  },
  setGradientReverse: (reverse) => set({ gradientReverse: reverse }),
  addGradientStop: (position, color) => set((state) => {
    if (state.gradientStops.length >= 16) return state;
    const newStops = [...state.gradientStops, { position: Math.max(0, Math.min(1, position)), color }];
    newStops.sort((a, b) => a.position - b.position);
    return { gradientStops: newStops };
  }),
  removeGradientStop: (index) => set((state) => {
    if (state.gradientStops.length <= 2) return state;
    const newStops = state.gradientStops.filter((_, i) => i !== index);
    return { gradientStops: newStops };
  }),
  updateGradientStop: (index, partial) => set((state) => {
    const newStops = state.gradientStops.map((stop, i) => {
      if (i !== index) return stop;
      return {
        position: partial.position !== undefined ? Math.max(0, Math.min(1, partial.position)) : stop.position,
        color: partial.color ?? stop.color,
      };
    });
    return { gradientStops: [...newStops].sort((a, b) => a.position - b.position) };
  }),
  setSymmetryHorizontal: (enabled) => set({ symmetryHorizontal: enabled }),
  setSymmetryVertical: (enabled) => set({ symmetryVertical: enabled }),
  setStampSize: (size) => set({ stampSize: Math.max(1, Math.min(200, size)) }),
  setPathStrokeWidth: (width) => set({ pathStrokeWidth: Math.max(1, Math.min(50, width)) }),
  setDodgeExposure: (exposure) => set({ dodgeExposure: Math.max(1, Math.min(100, exposure)) }),
  setDodgeMode: (mode) => set({ dodgeMode: mode }),
  setSmudgeSize: (size) => set({ smudgeSize: Math.max(1, Math.min(200, size)) }),
  setSmudgeStrength: (strength) => set({ smudgeStrength: Math.max(0, Math.min(100, strength)) }),
  setWandTolerance: (tolerance) => set({ wandTolerance: Math.max(0, Math.min(255, tolerance)) }),
  setWandContiguous: (contiguous) => set({ wandContiguous: contiguous }),
  setMagneticLassoWidth: (width) => set({ magneticLassoWidth: Math.max(1, Math.min(40, Math.round(width))) }),
  setMagneticLassoContrast: (contrast) => set({ magneticLassoContrast: Math.max(1, Math.min(100, Math.round(contrast))) }),
  setMagneticLassoFrequency: (frequency) => set({ magneticLassoFrequency: Math.max(0, Math.min(200, Math.round(frequency))) }),
  setTextContent: (content) => set({ textContent: content }),
  setTextFontSize: (size) => set({ textFontSize: Math.max(1, Math.min(500, size)) }),
  setTextFontFamily: (family) => set({ textFontFamily: family }),
  setTextFontWeight: (weight) => set({ textFontWeight: weight }),
  setTextFontStyle: (style) => set({ textFontStyle: style }),
  setTextAlign: (align) => set({ textAlign: align }),

  setForegroundColor: (color) => set({ foregroundColor: color }),
  setBackgroundColor: (color) => set({ backgroundColor: color }),
  swapColors: () =>
    set((state) => ({
      foregroundColor: state.backgroundColor,
      backgroundColor: state.foregroundColor,
    })),
  resetColors: () =>
    set({
      foregroundColor: { r: 0, g: 0, b: 0, a: 1 },
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    }),
  addRecentColor: (color) =>
    set((state) => {
      const filtered = state.recentColors.filter((c) => !colorEquals(c, color));
      return { recentColors: [color, ...filtered].slice(0, MAX_RECENT_COLORS) };
    }),

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
    const state = get();
    const preset = state.presets.find((p) => p.id === id);
    if (!preset) return;
    set({ activePresetId: id });
    state.setBrushSize(preset.size);
    state.setBrushHardness(preset.hardness);
    state.setBrushOpacity(preset.opacity);
    state.setBrushSpacing(preset.spacing);
    state.setBrushScatter(preset.scatter);
    state.setBrushAngle(preset.angle);
    state.setActiveBrushTip(preset.tip);
  },
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
