/**
 * Per-tool settings slice for the Bucket Fill tool.
 *
 * Authoritative settings type for fill. The slice lives under
 * `settings.fill` on the global ToolSettings store (see #453).
 * Follows the same pattern as `wand-settings.ts` — `<Tool>Settings`
 * interface + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting`
 * helper, then registered in `tool-settings-slices.ts`.
 */
export interface FillSettings {
  tolerance: number;
  contiguous: boolean;
}

export const DEFAULT_FILL_SETTINGS: FillSettings = {
  tolerance: 32,
  contiguous: true,
};

export function clampFillSetting<K extends keyof FillSettings>(
  key: K,
  value: FillSettings[K],
): FillSettings[K] {
  if (key === 'tolerance') {
    const n = value as number;
    return Math.max(0, Math.min(255, n)) as FillSettings[K];
  }
  return value;
}
