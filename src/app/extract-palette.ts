import { getEngine } from '../engine-wasm/engine-state';
import { flushLayerSync } from '../engine-wasm/engine-sync';
import { extractCompositePalette } from '../engine-wasm/wasm-bridge';
import { finalizePendingStrokeGlobal } from './interactions/pending-stroke';
import { useEditorStore } from './editor-store';
import { paletteFromBytes } from './store/actions/convert-color-mode';
import { sortColorsForPalette } from '../panels/SwatchesPanel/swatches';
import type { Color } from '../types';

/**
 * Pull up to `maxColors` dominant colors out of the flattened document —
 * median cut (as Image → Mode → Indexed uses) refined by k-means in the
 * engine, so each entry is a color that actually occurs in the image.
 * Transparent pixels are ignored, so an image on a transparent canvas yields
 * only its painted colors.
 */
export function extractDocumentPalette(maxColors: number): Color[] {
  const engine = getEngine();
  if (!engine) return [];
  finalizePendingStrokeGlobal();
  flushLayerSync(useEditorStore.getState());
  const palette = paletteFromBytes(extractCompositePalette(engine, maxColors));
  return sortColorsForPalette(palette.map((c) => ({ ...c, a: 1 })));
}
