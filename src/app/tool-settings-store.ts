import { create } from 'zustand';

interface ToolSettings {
  brushSize: number;
  brushOpacity: number;
  brushHardness: number;
  pencilSize: number;
  eraserSize: number;
  eraserOpacity: number;
  fillTolerance: number;
  fillContiguous: boolean;
  shapeMode: 'rectangle' | 'ellipse';
  shapeFill: boolean;
  shapeStrokeWidth: number;
  gradientType: 'linear' | 'radial';
  stampSize: number;
  pathStrokeWidth: number;
  dodgeExposure: number;
  dodgeMode: 'dodge' | 'burn';
  wandTolerance: number;
  wandContiguous: boolean;
  textContent: string;
  textFontSize: number;
  textFontFamily: string;

  setBrushSize: (size: number) => void;
  setStampSize: (size: number) => void;
  setPathStrokeWidth: (width: number) => void;
  setDodgeExposure: (exposure: number) => void;
  setDodgeMode: (mode: 'dodge' | 'burn') => void;
  setWandTolerance: (tolerance: number) => void;
  setWandContiguous: (contiguous: boolean) => void;
  setTextContent: (content: string) => void;
  setTextFontSize: (size: number) => void;
  setTextFontFamily: (family: string) => void;
  setBrushOpacity: (opacity: number) => void;
  setBrushHardness: (hardness: number) => void;
  setPencilSize: (size: number) => void;
  setEraserSize: (size: number) => void;
  setEraserOpacity: (opacity: number) => void;
  setFillTolerance: (tolerance: number) => void;
  setFillContiguous: (contiguous: boolean) => void;
  setShapeMode: (mode: 'rectangle' | 'ellipse') => void;
  setShapeFill: (fill: boolean) => void;
  setShapeStrokeWidth: (width: number) => void;
  setGradientType: (type: 'linear' | 'radial') => void;
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
  shapeMode: 'rectangle',
  shapeFill: true,
  shapeStrokeWidth: 2,
  gradientType: 'linear',
  stampSize: 20,
  pathStrokeWidth: 2,
  dodgeExposure: 50,
  dodgeMode: 'dodge',
  wandTolerance: 32,
  wandContiguous: true,
  textContent: 'Text',
  textFontSize: 24,
  textFontFamily: 'sans-serif',

  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(200, size)) }),
  setBrushOpacity: (opacity) => set({ brushOpacity: Math.max(1, Math.min(100, opacity)) }),
  setBrushHardness: (hardness) => set({ brushHardness: Math.max(0, Math.min(100, hardness)) }),
  setPencilSize: (size) => set({ pencilSize: Math.max(1, Math.min(100, size)) }),
  setEraserSize: (size) => set({ eraserSize: Math.max(1, Math.min(200, size)) }),
  setEraserOpacity: (opacity) => set({ eraserOpacity: Math.max(1, Math.min(100, opacity)) }),
  setFillTolerance: (tolerance) => set({ fillTolerance: Math.max(0, Math.min(255, tolerance)) }),
  setFillContiguous: (contiguous) => set({ fillContiguous: contiguous }),
  setShapeMode: (mode) => set({ shapeMode: mode }),
  setShapeFill: (fill) => set({ shapeFill: fill }),
  setShapeStrokeWidth: (width) => set({ shapeStrokeWidth: Math.max(1, Math.min(50, width)) }),
  setGradientType: (type) => set({ gradientType: type }),
  setStampSize: (size) => set({ stampSize: Math.max(1, Math.min(200, size)) }),
  setPathStrokeWidth: (width) => set({ pathStrokeWidth: Math.max(1, Math.min(50, width)) }),
  setDodgeExposure: (exposure) => set({ dodgeExposure: Math.max(1, Math.min(100, exposure)) }),
  setDodgeMode: (mode) => set({ dodgeMode: mode }),
  setWandTolerance: (tolerance) => set({ wandTolerance: Math.max(0, Math.min(255, tolerance)) }),
  setWandContiguous: (contiguous) => set({ wandContiguous: contiguous }),
  setTextContent: (content) => set({ textContent: content }),
  setTextFontSize: (size) => set({ textFontSize: Math.max(1, Math.min(500, size)) }),
  setTextFontFamily: (family) => set({ textFontFamily: family }),
}));
