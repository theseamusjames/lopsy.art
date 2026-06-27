import type { BrushTextureData, BrushTextureBlendMode } from '../../types/brush';

/**
 * Per-tool settings slice for the Brush tool's **texture** sub-namespace.
 *
 * Authoritative settings type for the brush-texture overlay (the grayscale
 * tileable texture multiplied / subtracted / overlaid onto each dab). The
 * slice lives under `settings.brushTexture` on the global ToolSettings store
 * (see #453). Same pattern as the other per-tool slices:
 * `<Tool>Settings` interface + `DEFAULT_<TOOL>_SETTINGS` + a
 * `clamp<Tool>Setting` helper, then registered in `tool-settings-slices.ts`.
 *
 * Three fields cover the per-stroke texture configuration: the active
 * `data` (or `null` for no texture), the `blendMode` it composites with,
 * and the `scale` percent applied to the texture's UVs in the shader.
 *
 * The available-textures catalogue (`brushTextures: BrushTextureData[]`)
 * stays at the store root by design — it's a cross-tool collection of
 * importable assets, sibling to `presets` and `activeSubBrushes`, not a
 * per-stroke setting.
 */
export interface BrushTextureSettings {
  data: BrushTextureData | null;
  blendMode: BrushTextureBlendMode;
  scale: number;
}

export const DEFAULT_BRUSH_TEXTURE_SETTINGS: BrushTextureSettings = {
  data: null,
  blendMode: 'multiply',
  scale: 100,
};

export function clampBrushTextureSetting<K extends keyof BrushTextureSettings>(
  key: K,
  value: BrushTextureSettings[K],
): BrushTextureSettings[K] {
  if (key === 'scale') {
    const n = value as number;
    return Math.max(10, Math.min(300, n)) as BrushTextureSettings[K];
  }
  return value;
}
