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
  brushSize: 10,
  brushOpacity: 100,
  brushHardness: 80,
  aspectRatioW: 1,
  aspectRatioH: 1,
  aspectRatioLocked: false,
  cropMode: 'normal' as const,
  gradientType: 'linear',
  gradientStops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
  ],
  gradientReverse: false,
  brushSpacing: 0,
  brushScatter: 0,
  brushAngle: 0,
  brushFade: 0,
  brushTaper: 0,
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
  brushSpeedSize: 0,
  brushSpeedSizeInvert: false,
  brushSpeedSensitivity: 'med',
  brushTextures: BUILTIN_TEXTURES,
  presets: BUILTIN_PRESETS,
  activePresetId: 'builtin-hard-round',
  activeSubBrushes: [],

  setBrushSizeJitter: (jitter) => set({ brushSizeJitter: Math.max(0, Math.min(100, jitter)) }),
  setBrushAngleJitter: (jitter) => set({ brushAngleJitter: Math.max(0, Math.min(100, jitter)) }),
  setBrushOpacityJitter: (jitter) => set({ brushOpacityJitter: Math.max(0, Math.min(100, jitter)) }),
  setBrushHardnessJitter: (jitter) => set({ brushHardnessJitter: Math.max(0, Math.min(100, jitter)) }),
  setBrushSpeedSize: (value) => set({ brushSpeedSize: Math.max(0, Math.min(300, value)) }),
  setBrushSpeedSizeInvert: (invert) => set({ brushSpeedSizeInvert: invert }),
  setBrushSpeedSensitivity: (sensitivity) => set({ brushSpeedSensitivity: sensitivity }),
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
  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(5000, size)) }),
  setBrushFade: (fade) => set({ brushFade: Math.max(0, Math.min(5000, fade)) }),
  setBrushTaper: (taper) => set({ brushTaper: Math.max(0, Math.min(5000, taper)) }),
  setBrushSpacing: (spacing) => set({ brushSpacing: Math.max(0, Math.min(200, spacing)) }),
  setBrushScatter: (scatter) => set({ brushScatter: Math.max(0, Math.min(100, scatter)) }),
  setBrushAngle: (angle) => set({ brushAngle: ((angle % 360) + 360) % 360 }),
  setActiveBrushTip: (tip) => set({ activeBrushTip: tip }),
  setBrushOpacity: (opacity) => {
    warnIfNormalisedOpacity('setBrushOpacity', opacity);
    set({ brushOpacity: Math.max(1, Math.min(100, opacity)) });
  },
  setBrushHardness: (hardness) => set({ brushHardness: Math.max(0, Math.min(100, hardness)) }),
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
  setCropMode: (mode) => set({ cropMode: mode }),
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
    const preset: BrushPreset = {
      id: createPresetId(),
      name,
      tip: s.activeBrushTip,
      size: s.brushSize,
      hardness: s.brushHardness,
      spacing: s.brushSpacing,
      scatter: s.brushScatter,
      angle: s.brushAngle,
      opacity: s.brushOpacity,
      flow: 100,
      isCustom: true,
      sizeJitter: s.brushSizeJitter,
      hardnessJitter: s.brushHardnessJitter,
      angleJitter: s.brushAngleJitter,
      opacityJitter: s.brushOpacityJitter,
      speedSize: s.brushSpeedSize,
      speedSizeInvert: s.brushSpeedSizeInvert,
      speedSensitivity: s.brushSpeedSensitivity,
      fade: s.brushFade,
      taper: s.brushTaper,
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
      brushSize: preset.size,
      brushHardness: preset.hardness,
      brushOpacity: preset.opacity,
      brushSpacing: preset.spacing,
      brushScatter: preset.scatter,
      brushAngle: preset.angle,
      activeBrushTip: preset.tip,
      brushSizeJitter: preset.sizeJitter ?? 0,
      brushHardnessJitter: preset.hardnessJitter ?? 0,
      brushAngleJitter: preset.angleJitter ?? 0,
      brushOpacityJitter: preset.opacityJitter ?? 0,
      brushSpeedSize: preset.speedSize ?? 0,
      brushSpeedSizeInvert: preset.speedSizeInvert ?? false,
      brushSpeedSensitivity: preset.speedSensitivity ?? 'med',
      brushFade: preset.fade ?? 0,
      brushTaper: preset.taper ?? 0,
      settings: { ...s.settings, brushTexture: { data: null, blendMode: 'multiply', scale: 100 } },
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
