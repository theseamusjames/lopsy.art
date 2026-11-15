/**
 * Per-tool settings slice for the Crop tool.
 *
 * Authoritative settings type for crop. The slice lives under
 * `settings.crop` on the global ToolSettings store (see #453).
 * Same pattern as `wand-settings.ts` / `fill-settings.ts` /
 * `marquee-settings.ts` / `smudge-settings.ts` / `pencil-settings.ts` /
 * `sponge-settings.ts` / `eraser-settings.ts` / `path-settings.ts` /
 * `stamp-settings.ts` / `magnetic-lasso-settings.ts` /
 * `text-settings.ts` / `spray-settings.ts` / `healing-settings.ts`:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` +
 * `clamp<Tool>Setting` helper, then registered in
 * `tool-settings-slices.ts`. Single discriminated field — `mode`
 * picks between the rectangular crop and the perspective-quad crop;
 * aspect-ratio fields stay flat for now since they are shared with
 * Shape / Marquee / Lasso and aren't crop-owned.
 */
export interface CropSettings {
  mode: 'normal' | 'perspective';
}

export const DEFAULT_CROP_SETTINGS: CropSettings = {
  mode: 'normal',
};

export function clampCropSetting<K extends keyof CropSettings>(
  key: K,
  value: CropSettings[K],
): CropSettings[K] {
  if (key === 'mode') {
    const v = value as CropSettings['mode'];
    if (v !== 'normal' && v !== 'perspective') {
      return 'normal' as CropSettings[K];
    }
    return v as CropSettings[K];
  }
  return value;
}
