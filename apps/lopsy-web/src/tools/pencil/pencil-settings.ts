/**
 * Per-tool settings slice for the Pencil tool.
 *
 * Authoritative settings type for pencil. The slice lives under
 * `settings.pencil` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts`: `<Tool>Settings`
 * interface + `DEFAULT_<TOOL>_SETTINGS` + a `clamp<Tool>Setting`
 * helper, then registered in `tool-settings-slices.ts`. Single
 * numeric field — same shape as marquee, but covers a paint tool
 * (rather than a selection tool) so the slice infrastructure is
 * exercised on the paint-tool code path before the largest paint
 * slice (brush) inherits it.
 */
export interface PencilSettings {
  size: number;
}

export const DEFAULT_PENCIL_SETTINGS: PencilSettings = {
  size: 1,
};

export function clampPencilSetting<K extends keyof PencilSettings>(
  key: K,
  value: PencilSettings[K],
): PencilSettings[K] {
  if (key === 'size') {
    const n = value as number;
    return Math.max(1, Math.min(5000, n)) as PencilSettings[K];
  }
  return value;
}
