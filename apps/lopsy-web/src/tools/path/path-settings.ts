/**
 * Per-tool settings slice for the Path (vector) tool.
 *
 * Authoritative settings type for path. The slice lives under
 * `settings.path` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts`: `<Tool>Settings`
 * interface + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting`
 * helper, then registered in `tool-settings-slices.ts`. Single
 * numeric field, but covers a vector tool (the others were paint
 * or selection) so the slice infrastructure is exercised on a new
 * tool class — and the value is consumed in a modal (StrokePathModal)
 * rather than the canvas hot path, which is a new read-site pattern.
 */
export interface PathSettings {
  strokeWidth: number;
}

export const DEFAULT_PATH_SETTINGS: PathSettings = {
  strokeWidth: 2,
};

export function clampPathSetting<K extends keyof PathSettings>(
  key: K,
  value: PathSettings[K],
): PathSettings[K] {
  if (key === 'strokeWidth') {
    const n = value as number;
    return Math.max(1, Math.min(50, n)) as PathSettings[K];
  }
  return value;
}
