import type { Color } from '../../types';

export type QuickMaskPaintTool = 'brush' | 'pencil' | 'eraser';

/**
 * Quick-mask paint mode values consumed by the GPU shader
 * (`engine-rs/.../gpu/shaders/brush/quick_mask_dab.glsl`):
 *   0 = paint white into the mask → grow selection → remove overlay
 *   1 = paint black into the mask → shrink selection → add overlay
 *
 * Brushes and pencils respect the foreground color so that painting black
 * adds the overlay and painting white removes it — matching the user
 * expectation for quick-mask editing. Eraser keeps its existing semantics
 * (always paints black into the mask).
 */
export function getQuickMaskPaintMode(
  tool: QuickMaskPaintTool,
  color: Color,
): 0 | 1 {
  if (tool === 'eraser') return 1;
  return isLightColor(color) ? 0 : 1;
}

function isLightColor(color: Color): boolean {
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return luminance >= 128;
}
