/**
 * Per-tool settings slice for the Quick Selection tool.
 *
 * Authoritative settings type for quick-select. The slice lives under
 * `settings.quickSelect` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts` / `magnetic-lasso-settings.ts`: `<Tool>Settings`
 * interface + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting` helper,
 * then registered in `tool-settings-slices.ts`.
 *
 * Three rounded numeric fields with different clamp ranges plus one
 * enum mode field — the first slice on the assistant-selection tool
 * class to mix a tagged-union enum with numeric ranges, and the first
 * slice carrying a 0–255 byte range (`tolerance` lives in the same
 * units as RGBA channels because the stroke compares pixel deltas
 * against it directly).
 */
export type QuickSelectMode = 'add' | 'subtract';

export interface QuickSelectSettings {
  size: number;
  tolerance: number;
  edgeStrength: number;
  mode: QuickSelectMode;
}

export const DEFAULT_QUICK_SELECT_SETTINGS: QuickSelectSettings = {
  size: 20,
  tolerance: 32,
  edgeStrength: 50,
  mode: 'add',
};

export function clampQuickSelectSetting<K extends keyof QuickSelectSettings>(
  key: K,
  value: QuickSelectSettings[K],
): QuickSelectSettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(100, Math.round(n))) as QuickSelectSettings[K];
  }
  if (key === 'tolerance') {
    const n = value as number;
    return Math.max(0, Math.min(255, Math.round(n))) as QuickSelectSettings[K];
  }
  if (key === 'edgeStrength') {
    const n = value as number;
    return Math.max(0, Math.min(100, Math.round(n))) as QuickSelectSettings[K];
  }
  if (key === 'mode') {
    const m = value as QuickSelectMode;
    return (m === 'subtract' ? 'subtract' : 'add') as QuickSelectSettings[K];
  }
  return value;
}
