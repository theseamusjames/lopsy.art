import { useEditorStore } from './editor-store';
import { convertColorToDocMode, encodeColorForEngine } from '../utils/color-mode';
import type { Color } from '../types';

/**
 * Turn a user-chosen color into the value a layer texture should receive.
 *
 * Every paint entry point (brush, pencil, spray, fill, gradient, text, shape)
 * routes colors through this, so a mode's constraint holds even when the color
 * arrived from a preset, the eyedropper, or settings saved under a previous
 * mode. Two steps: constrain to what the mode can represent, then re-encode
 * into whatever the texture actually stores.
 */
export function toDocumentColor(color: Color): Color {
  const doc = useEditorStore.getState().document;
  const constrained = convertColorToDocMode(color, doc.colorMode, doc.indexedPalette);
  return encodeColorForEngine(constrained, doc.colorMode);
}
