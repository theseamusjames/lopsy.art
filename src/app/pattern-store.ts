import { create } from 'zustand';

export interface PatternDefinition {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly thumbnail: string;
}

interface PatternStore {
  readonly patterns: readonly PatternDefinition[];
  readonly activePatternId: string | null;
  addPattern: (pattern: PatternDefinition) => void;
  removePattern: (id: string) => void;
  setActivePattern: (id: string | null) => void;
}

function generateThumbnail(data: Uint8Array, width: number, height: number): string {
  const maxSize = 64;
  const scale = Math.min(maxSize / width, maxSize / height, 1);
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const clamped = new Uint8ClampedArray(data.length);
  clamped.set(data);
  const src = new ImageData(clamped, width, height);
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return '';
  srcCtx.putImageData(src, 0, 0);

  ctx.drawImage(srcCanvas, 0, 0, tw, th);
  return canvas.toDataURL('image/png');
}

export const usePatternStore = create<PatternStore>((set) => ({
  patterns: [],
  activePatternId: null,

  addPattern: (pattern) =>
    set((state) => ({
      patterns: [...state.patterns, pattern],
      activePatternId: pattern.id,
    })),

  removePattern: (id) =>
    set((state) => ({
      patterns: state.patterns.filter((p) => p.id !== id),
      activePatternId: state.activePatternId === id ? null : state.activePatternId,
    })),

  setActivePattern: (id) => set({ activePatternId: id }),
}));

export { generateThumbnail };
