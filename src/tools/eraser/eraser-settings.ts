/**
 * Per-tool settings slice for the Eraser tool.
 *
 * Authoritative settings type for eraser. The slice lives under
 * `settings.eraser` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Two numeric fields: `size` and `opacity`.
 * The opacity clamp range starts at 1 (not 0) — matches the legacy
 * `setEraserOpacity` so callers don't silently get a no-op stroke.
 */
export interface EraserSettings {
  size: number;
  opacity: number;
}

export const DEFAULT_ERASER_SETTINGS: EraserSettings = {
  size: 10,
  opacity: 100,
};

export function clampEraserSetting<K extends keyof EraserSettings>(
  key: K,
  value: EraserSettings[K],
): EraserSettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as EraserSettings[K];
  }
  if (key === 'opacity') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as EraserSettings[K];
  }
  return value;
}
