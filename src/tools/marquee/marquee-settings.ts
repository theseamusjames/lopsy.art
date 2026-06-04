/**
 * Per-tool settings slice for the Marquee tool.
 *
 * Authoritative settings type for marquee. The slice lives under
 * `settings.marquee` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` and `fill-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Single-field tool — proves the slice
 * shape degenerates cleanly when there's nothing to silo siblings from.
 */
export interface MarqueeSettings {
  feather: number;
}

export const DEFAULT_MARQUEE_SETTINGS: MarqueeSettings = {
  feather: 0,
};

export function clampMarqueeSetting<K extends keyof MarqueeSettings>(
  key: K,
  value: MarqueeSettings[K],
): MarqueeSettings[K] {
  if (key === 'feather') {
    const n = value as number;
    return Math.max(0, Math.min(250, Math.round(n))) as MarqueeSettings[K];
  }
  return value;
}
