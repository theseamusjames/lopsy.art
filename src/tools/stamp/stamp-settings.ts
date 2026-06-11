/**
 * Per-tool settings slice for the Clone Stamp tool.
 *
 * Authoritative settings type for stamp. The slice lives under
 * `settings.stamp` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` +
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Single numeric field, but covers the
 * clone-stamp tool class (the others were paint / selection / vector)
 * so the slice infrastructure is exercised on a new tool class.
 */
export interface StampSettings {
  size: number;
}

export const DEFAULT_STAMP_SETTINGS: StampSettings = {
  size: 20,
};

export function clampStampSetting<K extends keyof StampSettings>(
  key: K,
  value: StampSettings[K],
): StampSettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as StampSettings[K];
  }
  return value;
}
