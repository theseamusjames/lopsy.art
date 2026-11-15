/**
 * Per-tool settings slice for the Magic Wand tool.
 *
 * Authoritative settings type for wand. The slice lives under
 * `settings.wand` on the global ToolSettings store (see #453).
 * Future per-tool slices follow the same pattern: a `<Tool>Settings`
 * interface + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting`
 * helper, then registered in `tool-settings-slices.ts`.
 */
export interface WandSettings {
  tolerance: number;
  contiguous: boolean;
  graduated: boolean;
}

export const DEFAULT_WAND_SETTINGS: WandSettings = {
  tolerance: 32,
  contiguous: true,
  graduated: false,
};

export function clampWandSetting<K extends keyof WandSettings>(
  key: K,
  value: WandSettings[K],
): WandSettings[K] {
  if (key === 'tolerance') {
    const n = value as number;
    return Math.max(0, Math.min(255, n)) as WandSettings[K];
  }
  return value;
}
