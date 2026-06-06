/**
 * Per-tool settings slice for the Smudge tool.
 *
 * Authoritative settings type for smudge. The slice lives under
 * `settings.smudge` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts`: `<Tool>Settings` interface +
 * `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting` helper, then
 * registered in `tool-settings-slices.ts`. Two numeric fields — the
 * first slice to carry a pure dual-number shape (no booleans, no
 * enums), confirming the slice infrastructure also handles tools
 * whose every setting is a numeric clamp.
 */
export interface SmudgeSettings {
  size: number;
  strength: number;
}

export const DEFAULT_SMUDGE_SETTINGS: SmudgeSettings = {
  size: 30,
  strength: 50,
};

export function clampSmudgeSetting<K extends keyof SmudgeSettings>(
  key: K,
  value: SmudgeSettings[K],
): SmudgeSettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as SmudgeSettings[K];
  }
  if (key === 'strength') {
    const n = value as number;
    return Math.max(0, Math.min(100, n)) as SmudgeSettings[K];
  }
  return value;
}
