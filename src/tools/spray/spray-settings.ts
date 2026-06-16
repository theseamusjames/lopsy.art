/**
 * Per-tool settings slice for the Spray tool.
 *
 * Authoritative settings type for spray. The slice lives under
 * `settings.spray` on the global ToolSettings store (see #453). Same
 * pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts` / `magnetic-lasso-settings.ts`: `<Tool>Settings`
 * interface + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting`
 * helper, then registered in `tool-settings-slices.ts`. Four numeric
 * fields with distinct clamp ranges — `opacity` carries the same
 * percent-vs-normalised footgun as `setBrushOpacity` and
 * `setEraserSetting('opacity')`, so the warn-once dedupe runs at the
 * store edge (not here) when callers reach for it via
 * `setSpraySetting('opacity', …)`.
 */
export interface SpraySettings {
  size: number;
  density: number;
  opacity: number;
  hardness: number;
}

export const DEFAULT_SPRAY_SETTINGS: SpraySettings = {
  size: 40,
  density: 20,
  opacity: 60,
  hardness: 30,
};

export function clampSpraySetting<K extends keyof SpraySettings>(
  key: K,
  value: SpraySettings[K],
): SpraySettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as SpraySettings[K];
  }
  if (key === 'density') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as SpraySettings[K];
  }
  if (key === 'opacity') {
    const n = value as number;
    return Math.max(1, Math.min(100, n)) as SpraySettings[K];
  }
  if (key === 'hardness') {
    const n = value as number;
    return Math.max(0, Math.min(100, n)) as SpraySettings[K];
  }
  return value;
}
