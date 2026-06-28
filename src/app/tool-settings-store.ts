import { create } from 'zustand';
import type { BrushPreset } from '../types/brush';
import type { ToolSettings } from './tool-settings-types';
import { BUILTIN_PRESETS, BUILTIN_TEXTURES, createPresetId } from '../tools/brush/builtin-presets';
import { colorEquals } from '../utils/color';
import { DEFAULT_TOOL_SETTINGS_SLICES } from './tool-settings-slices';
import { clampWandSetting } from '../tools/wand/wand-settings';
import { clampFillSetting } from '../tools/fill/fill-settings';
import { clampMarqueeSetting } from '../tools/marquee/marquee-settings';
import { clampSmudgeSetting } from '../tools/smudge/smudge-settings';
import { clampPencilSetting } from '../tools/pencil/pencil-settings';
import { clampSpongeSetting } from '../tools/sponge/sponge-settings';
import { clampEraserSetting } from '../tools/eraser/eraser-settings';
import { clampPathSetting } from '../tools/path/path-settings';
import { clampStampSetting } from '../tools/stamp/stamp-settings';
import { clampMagneticLassoSetting } from '../tools/magnetic-lasso/magnetic-lasso-settings';
import { clampTextSetting } from '../tools/text/text-settings';
import { clampSpraySetting } from '../tools/spray/spray-settings';
import { clampHealingSetting } from '../tools/healing/healing-settings';
import { clampBrushTextureSetting } from '../tools/brush/brush-texture-settings';
import { clampDodgeSetting } from '../tools/dodge/dodge-settings';
import { clampQuickSelectSetting } from '../tools/quick-select/quick-select-settings';
import { clampShapeSetting } from '../tools/shape/shape-settings';
import {
  appendGradientStop,
  clampGradientSetting,
  removeGradientStopAt,
  updateGradientStopAt,
} from '../tools/gradient/gradient-settings';
import { clampCropSetting } from '../tools/crop/crop-settings';
import { clampBrushSetting } from '../tools/brush/brush-settings';
import { clampBrushSpeedSetting } from '../tools/brush/brush-speed-settings';

export type { ToolSettings } from './tool-settings-types';

export { abrBrushToPreset } from '../tools/brush/builtin-presets';

const MAX_RECENT_COLORS = 28;

// Opacity setters in this store take **percent** (1–100), not normalised
// 0–1. Callers reaching for normalised opacity (which is what colours and
// layer alpha use elsewhere) will silently end up with ~1% strokes. Warn
// once per setter when the input looks normalised — fractional and not
// the legitimate sentinel 0.
const warnedNormalisedOpacity = new Set<string>();
function warnIfNormalisedOpacity(setter: string, value: number): void {
  if (value > 0 && value < 1 && !warnedNormalisedOpacity.has(setter)) {
    warnedNormalisedOpacity.add(setter);
    console.warn(
      `[tool-settings] ${setter}(${value}) looks like a normalised 0–1 opacity. ` +
      `This setter expects percent (1–100). Did you mean ${Math.round(value * 100)}?`,
    );
  }
}

export const useToolSettingsStore = create<ToolSettings>((set, get) => ({
  settings: DEFAULT_TOOL_SETTINGS_SLICES,
  aspectRatioW: 1,
  aspectRatioH: 1,
  aspectRatioLocked: false,
  activeBrushTip: null,
  symmetryHorizontal: false,
  symmetryVertical: false,
  symmetryRadialSegments: 0,
  symmetryCenter: null,
  foregroundColor: { r: 0, g: 0, b: 0, a: 1 },
  backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
  recentColors: [
    { r: 255, g: 255, b: 255, a: 1 },
    { r: 0,   g: 0,   b: 0,   a: 1 },
    { r: 128, g: 128, b: 128, a: 1 },
    { r: 255, g: 0,   b: 0,   a: 1 },
    { r: 255, g: 100, b: 0,   a: 1 },
    { r: 255, g: 200, b: 0,   a: 1 },
    { r: 0,   g: 200, b: 0,   a: 1 },
    { r: 0,   g: 150, b: 255, a: 1 },
    { r: 80,  g: 0,   b: 255, a: 1 },
    { r: 200, g: 0,   b: 200, a: 1 },
    { r: 255, g: 180, b: 180, a: 1 },
    { r: 255, g: 220, b: 180, a: 1 },
    { r: 255, g: 255, b: 180, a: 1 },
    { r: 180, g: 255, b: 180, a: 1 },
    { r: 180, g: 220, b: 255, a: 1 },
    { r: 200, g: 180, b: 255, a: 1 },
    { r: 80,  g: 50,  b: 20,  a: 1 },
    { r: 150, g: 100, b: 50,  a: 1 },
    { r: 0,   g: 80,  b: 80,  a: 1 },
    { r: 50,  g: 50,  b: 80,  a: 1 },
    { r: 180, g: 0,   b: 0,   a: 1 },
    { r: 0,   g: 100, b: 0,   a: 1 },
    { r: 0,   g: 0,   b: 180, a: 1 },
    { r: 255, g: 150, b: 200, a: 1 },
    { r: 200, g: 200, b: 200, a: 1 },
    { r: 100, g: 100, b: 100, a: 1 },
    { r: 255, g: 130, b: 0,   a: 1 },
    { r: 0,   g: 200, b: 200, a: 1 },
  ],
  brushSizeJitter: 0,
  brushAngleJitter: 0,
  brushOpacityJitter: 0,
  brushHardnessJitter: 0,
  brushTextures: BUILTIN_TEXTURES,
  presets: BUILTIN_PRESETS,
  activePresetId: 'builtin-hard-round',
  activeSubBrushes: [],

  setBrushSizeJitter: (jitter) => set({ brushSizeJitter: Math.max(0, Math.min(100, jitter)) }),
  setBrushAngleJitter: (jitter) => set({ brushAngleJitter: Math.max(0, Math.min(100, jitter)) }),
  setBrushOpacityJitter: (jitter) => set({ brushOpacityJitter: Math.max(0, Math.min(100, jitter)) }),
  setBrushHardnessJitter: (jitter) => set({ brushHardnessJitter: Math.max(0, Math.min(100, jitter)) }),
  setBrushSpeedSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      brushSpeed: { ...s.settings.brushSpeed, [key]: clampBrushSpeedSetting(key, value) },
    },
  })),
  setBrushTextureSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      brushTexture: { ...s.settings.brushTexture, [key]: clampBrushTextureSetting(key, value) },
    },
  })),
  addBrushTexture: (texture) => set((s) => ({ brushTextures: [...s.brushTextures, texture] })),
  removeBrushTexture: (id) => set((s) => ({
    brushTextures: s.brushTextures.filter((t) => t.id !== id),
    settings: s.settings.brushTexture.data?.id === id
      ? { ...s.settings, brushTexture: { ...s.settings.brushTexture, data: null } }
      : s.settings,
  })),
  setSpraySetting: (key, value) => {
    if (key === 'opacity') warnIfNormalisedOpacity('setSpraySetting(opacity)', value as number);
    set((s) => ({
      settings: {
        ...s.settings,
        spray: { ...s.settings.spray, [key]: clampSpraySetting(key, value) },
      },
    }));
  },
  setBrushSetting: (key, value) => {
    if (key === 'opacity') warnIfNormalisedOpacity('setBrushSetting(opacity)', value as number);
    set((s) => ({
      settings: {
        ...s.settings,
        brush: { ...s.settings.brush, [key]: clampBrushSetting(key, value) },
      },
    }));
  },
  setActiveBrushTip: (tip) => set({ activeBrushTip: tip }),
  setPencilSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      pencil: { ...s.settings.pencil, [key]: clampPencilSetting(key, value) },
    },
  })),
  setEraserSetting: (key, value) => {
    if (key === 'opacity') warnIfNormalisedOpacity('setEraserSetting(opacity)', value as number);
    set((s) => ({
      settings: {
        ...s.settings,
        eraser: { ...s.settings.eraser, [key]: clampEraserSetting(key, value) },
      },
    }));
  },
  setFillSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      fill: { ...s.settings.fill, [key]: clampFillSetting(key, value) },
    },
  })),
  setShapeSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      shape: { ...s.settings.shape, [key]: clampShapeSetting(key, value) },
    },
  })),
  setAspectRatioW: (w) => set({ aspectRatioW: Math.max(0.01, w) }),
  setAspectRatioH: (h) => set({ aspectRatioH: Math.max(0.01, h) }),
  setAspectRatioLocked: (locked) => set({ aspectRatioLocked: locked }),
  setCropSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      crop: { ...s.settings.crop, [key]: clampCropSetting(key, value) },
    },
  })),
  setGradientSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      gradient: { ...s.settings.gradient, [key]: clampGradientSetting(key, value) },
    },
  })),
  addGradientStop: (position, color) => set((s) => ({
    settings: {
      ...s.settings,
      gradient: {
        ...s.settings.gradient,
        stops: appendGradientStop(s.settings.gradient.stops, position, color),
      },
    },
  })),
  removeGradientStop: (index) => set((s) => ({
    settings: {
      ...s.settings,
      gradient: {
        ...s.settings.gradient,
        stops: removeGradientStopAt(s.settings.gradient.stops, index),
      },
    },
  })),
  updateGradientStop: (index, partial) => set((s) => ({
    settings: {
      ...s.settings,
      gradient: {
        ...s.settings.gradient,
        stops: updateGradientStopAt(s.settings.gradient.stops, index, partial),
      },
    },
  })),
  setSymmetryHorizontal: (enabled) => set({ symmetryHorizontal: enabled }),
  setSymmetryVertical: (enabled) => set({ symmetryVertical: enabled }),
  setSymmetryRadialSegments: (segments) => set({ symmetryRadialSegments: Math.max(0, Math.min(32, Math.round(segments))) }),
  setSymmetryCenter: (center) => set({ symmetryCenter: center }),
  setStampSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      stamp: { ...s.settings.stamp, [key]: clampStampSetting(key, value) },
    },
  })),
  setHealingSetting: (key, value) => {
    if (key === 'opacity') warnIfNormalisedOpacity('setHealingSetting(opacity)', value as number);
    set((s) => ({
      settings: {
        ...s.settings,
        healing: { ...s.settings.healing, [key]: clampHealingSetting(key, value) },
      },
    }));
  },
  setPathSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      path: { ...s.settings.path, [key]: clampPathSetting(key, value) },
    },
  })),
  setDodgeSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      dodge: { ...s.settings.dodge, [key]: clampDodgeSetting(key, value) },
    },
  })),
  setSpongeSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      sponge: { ...s.settings.sponge, [key]: clampSpongeSetting(key, value) },
    },
  })),
  setSmudgeSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      smudge: { ...s.settings.smudge, [key]: clampSmudgeSetting(key, value) },
    },
  })),
  setMarqueeSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      marquee: { ...s.settings.marquee, [key]: clampMarqueeSetting(key, value) },
    },
  })),
  setWandSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      wand: { ...s.settings.wand, [key]: clampWandSetting(key, value) },
    },
  })),
  setMagneticLassoSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      magneticLasso: { ...s.settings.magneticLasso, [key]: clampMagneticLassoSetting(key, value) },
    },
  })),
  setTextSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      text: { ...s.settings.text, [key]: clampTextSetting(key, value) },
    },
  })),
  setQuickSelectSetting: (key, value) => set((s) => ({
    settings: {
      ...s.settings,
      quickSelect: { ...s.settings.quickSelect, [key]: clampQuickSelectSetting(key, value) },
    },
  })),

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

  addSubBrush: (sub) => set((s) => ({ activeSubBrushes: [...s.activeSubBrushes, sub] })),
  removeSubBrush: (index) => set((s) => ({
    activeSubBrushes: s.activeSubBrushes.filter((_, i) => i !== index),
  })),
  updateSubBrush: (index, patch) => set((s) => ({
    activeSubBrushes: s.activeSubBrushes.map((sub, i) => i === index ? { ...sub, ...patch } : sub),
  })),
  clearSubBrushes: () => set({ activeSubBrushes: [] }),
  addPreset: (preset) => set((s) => ({ presets: [...s.presets, preset] })),
  addPresets: (presets) => set((s) => ({ presets: [...s.presets, ...presets] })),
  saveCurrentAsPreset: (name) => {
    const s = get();
    const b = s.settings.brush;
    const preset: BrushPreset = {
      id: createPresetId(),
      name,
      tip: s.activeBrushTip,
      size: b.size,
      hardness: b.hardness,
      spacing: b.spacing,
      scatter: b.scatter,
      angle: b.angle,
      opacity: b.opacity,
      flow: 100,
      isCustom: true,
      sizeJitter: s.brushSizeJitter,
      hardnessJitter: s.brushHardnessJitter,
      angleJitter: s.brushAngleJitter,
      opacityJitter: s.brushOpacityJitter,
      speedSize: s.settings.brushSpeed.size,
      speedSizeInvert: s.settings.brushSpeed.sizeInvert,
      speedSensitivity: s.settings.brushSpeed.sensitivity,
      fade: b.fade,
      taper: b.taper,
      subBrushes: s.activeSubBrushes.length > 0 ? s.activeSubBrushes : undefined,
    };
    set((state) => ({ presets: [...state.presets, preset], activePresetId: preset.id }));
  },
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
    set((s) => ({
      activePresetId: id,
      settings: {
        ...s.settings,
        brush: {
          size: preset.size,
          opacity: preset.opacity,
          hardness: preset.hardness,
          spacing: preset.spacing,
          scatter: preset.scatter,
          angle: preset.angle,
          fade: preset.fade ?? 0,
          taper: preset.taper ?? 0,
        },
        brushTexture: { data: null, blendMode: 'multiply', scale: 100 },
        brushSpeed: {
          size: clampBrushSpeedSetting('size', preset.speedSize ?? 0),
          sizeInvert: preset.speedSizeInvert ?? false,
          sensitivity: clampBrushSpeedSetting('sensitivity', preset.speedSensitivity ?? 'med'),
        },
      },
      activeBrushTip: preset.tip,
      brushSizeJitter: preset.sizeJitter ?? 0,
      brushHardnessJitter: preset.hardnessJitter ?? 0,
      brushAngleJitter: preset.angleJitter ?? 0,
      brushOpacityJitter: preset.opacityJitter ?? 0,
      activeSubBrushes: preset.subBrushes ?? [],
    }));
  },
  setTipFromPreset: (id) => {
    const state = get();
    const preset = state.presets.find((p) => p.id === id);
    if (!preset) return;
    state.setActiveBrushTip(preset.tip);
  },
}));

export { createPresetId } from '../tools/brush/builtin-presets';
