import { create } from 'zustand';
import type { Color } from '../types';
import type { GradientStop } from '../tools/gradient/gradient';
import type { BrushTipData } from '../types/brush';

interface ToolSettings {
  brushSize: number;
  brushOpacity: number;
  brushHardness: number;
  pencilSize: number;
  eraserSize: number;
  eraserOpacity: number;
  fillTolerance: number;
  fillContiguous: boolean;
  shapeMode: 'ellipse' | 'polygon';
  shapeOutput: 'pixels' | 'path';
  shapeFillColor: Color | null;
  shapeStrokeColor: Color | null;
  shapeStrokeWidth: number;
  shapePolygonSides: number;
  shapeCornerRadius: number;
  aspectRatioW: number;
  aspectRatioH: number;
  aspectRatioLocked: boolean;
  gradientType: 'linear' | 'radial';
  gradientStops: readonly GradientStop[];
  gradientReverse: boolean;
  stampSize: number;
  pathStrokeWidth: number;
  dodgeExposure: number;
  dodgeMode: 'dodge' | 'burn';
  smudgeSize: number;
  smudgeStrength: number;
  historyBrushSize: number;
  historyBrushOpacity: number;
  historyBrushHardness: number;
  historyBrushSourceId: string | null;
  wandTolerance: number;
  wandContiguous: boolean;
  magneticLassoWidth: number;
  magneticLassoContrast: number;
  magneticLassoFrequency: number;
  textContent: string;
  textFontSize: number;
  textFontFamily: string;
  textFontWeight: number;
  textFontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right' | 'justify';
  brushSpacing: number;
  brushScatter: number;
  brushAngle: number;
  brushFade: number;
  activeBrushTip: BrushTipData | null;
  symmetryHorizontal: boolean;
  symmetryVertical: boolean;

  setBrushSize: (size: number) => void;
  setBrushFade: (fade: number) => void;
  setBrushSpacing: (spacing: number) => void;
  setBrushScatter: (scatter: number) => void;
  setBrushAngle: (angle: number) => void;
  setActiveBrushTip: (tip: BrushTipData | null) => void;
  setStampSize: (size: number) => void;
  setPathStrokeWidth: (width: number) => void;
  setDodgeExposure: (exposure: number) => void;
  setDodgeMode: (mode: 'dodge' | 'burn') => void;
  setSmudgeSize: (size: number) => void;
  setSmudgeStrength: (strength: number) => void;
  setHistoryBrushSize: (size: number) => void;
  setHistoryBrushOpacity: (opacity: number) => void;
  setHistoryBrushHardness: (hardness: number) => void;
  setHistoryBrushSourceId: (id: string | null) => void;
  setWandTolerance: (tolerance: number) => void;
  setWandContiguous: (contiguous: boolean) => void;
  setMagneticLassoWidth: (width: number) => void;
  setMagneticLassoContrast: (contrast: number) => void;
  setMagneticLassoFrequency: (frequency: number) => void;
  setTextContent: (content: string) => void;
  setTextFontSize: (size: number) => void;
  setTextFontFamily: (family: string) => void;
  setTextFontWeight: (weight: number) => void;
  setTextFontStyle: (style: 'normal' | 'italic') => void;
  setTextAlign: (align: 'left' | 'center' | 'right' | 'justify') => void;
  setBrushOpacity: (opacity: number) => void;
  setBrushHardness: (hardness: number) => void;
  setPencilSize: (size: number) => void;
  setEraserSize: (size: number) => void;
  setEraserOpacity: (opacity: number) => void;
  setFillTolerance: (tolerance: number) => void;
  setFillContiguous: (contiguous: boolean) => void;
  setShapeMode: (mode: 'ellipse' | 'polygon') => void;
  setShapeOutput: (output: 'pixels' | 'path') => void;
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
}

export const useToolSettingsStore = create<ToolSettings>((set) => ({
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
  historyBrushSize: 30,
  historyBrushOpacity: 100,
  historyBrushHardness: 80,
  historyBrushSourceId: null,
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
  setHistoryBrushSize: (size) => set({ historyBrushSize: Math.max(1, Math.min(200, size)) }),
  setHistoryBrushOpacity: (opacity) => set({ historyBrushOpacity: Math.max(1, Math.min(100, opacity)) }),
  setHistoryBrushHardness: (hardness) => set({ historyBrushHardness: Math.max(0, Math.min(100, hardness)) }),
  setHistoryBrushSourceId: (id) => set({ historyBrushSourceId: id }),
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
}));
