import { useEditorStore } from './editor-store';
import { convertColorToDocMode } from '../utils/color-mode';
import type { Color } from '../types';

/**
 * Snap a user-chosen color to the active document's color mode.
 *
 * Every paint entry point (brush, pencil, spray, fill, gradient, text, shape)
 * routes colors through this before handing them to the engine, so a mode's
 * value-space constraint holds even if a color arrived from a preset, the
 * eyedropper, or settings saved under a previous mode.
 */
export function toDocumentColor(color: Color): Color {
  const doc = useEditorStore.getState().document;
  return convertColorToDocMode(color, doc.colorMode, doc.indexedPalette);
}
