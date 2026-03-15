import { PixelBuffer, MaskedPixelBuffer } from '../../engine/pixel-data';
import { useEditorStore } from '../editor-store';

export function wrapWithSelectionMask(buffer: PixelBuffer, layerX: number, layerY: number): PixelBuffer | MaskedPixelBuffer {
  const sel = useEditorStore.getState().selection;
  if (sel.active && sel.mask) {
    return new MaskedPixelBuffer(buffer, sel.mask, sel.maskWidth, sel.maskHeight, layerX, layerY);
  }
  return buffer;
}
