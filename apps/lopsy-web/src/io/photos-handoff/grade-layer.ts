/**
 * Grade in Lopsy Photos (spec 6.12, L5): sends one raster layer to Photos'
 * Edit view and, on Done, replaces the layer's pixels with the graded ones
 * as one history step, keeping the recipe on the layer for provenance.
 *
 * The layer travels as the engine's 16-bit blob and comes back as a 16-bit
 * PNG of the same size, so neither direction drops to 8 bits. A later grade
 * starts from the current (already graded) pixels with the default recipe;
 * the stored recipe is never applied again.
 */

import { gradeInPhotos, type GradeResult } from '@lopsy/handoff/grade';
import type { GradeLayer } from '@lopsy/handoff/messages';
import { useEditorStore } from '../../app/editor-store';
import { describeError, notifyError, notifyInfo } from '../../app/notifications-store';
import { finalizePendingStrokeGlobal } from '../../app/interactions/pending-stroke';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import { getEngine } from '../../engine-wasm/engine-state';
import { readLayerBackupBlob } from '../../engine-wasm/gpu-pixel-access';
import { decodeAndUploadImage } from '../../engine-wasm/wasm-bridge';
import { photosUrl } from './photos-url';
import { blobSize, canGradeLayer } from './grade-checks';

export const GRADE_HISTORY_LABEL = 'Grade in Lopsy Photos';

async function readGradeLayer(layerId: string, name: string): Promise<GradeLayer> {
  finalizePendingStrokeGlobal();
  flushLayerSync(useEditorStore.getState());
  const blob = await readLayerBackupBlob(layerId);
  const size = blob ? blobSize(blob) : null;
  if (!blob || !size) throw new Error('the layer is empty.');
  const pixels = new ArrayBuffer(blob.byteLength);
  new Uint8Array(pixels).set(blob);
  return { name, width: size.width, height: size.height, pixels };
}

/** Puts the graded pixels into the layer as one history step and stores the recipe on it. */
export function applyGrade(layerId: string, result: Extract<GradeResult, { kind: 'graded' }>, expected: { width: number; height: number }): void {
  const engine = getEngine();
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === layerId);
  if (!engine || !layer || layer.type !== 'raster') throw new Error('the layer is no longer in the document.');

  useEditorStore.getState().pushHistory(GRADE_HISTORY_LABEL);
  const size = decodeAndUploadImage(engine, layerId, new Uint8Array(result.png));
  if (size[0] !== expected.width || size[1] !== expected.height) {
    // Put the original back: a grade of another size is not this layer.
    useEditorStore.getState().undo();
    throw new Error(`the graded layer is ${size[0] ?? 0} × ${size[1] ?? 0}, not ${expected.width} × ${expected.height}.`);
  }
  clearJsPixelData(layerId);
  useEditorStore.setState((s) => ({
    document: {
      ...s.document,
      layers: s.document.layers.map((l) => (l.id === layerId && l.type === 'raster' ? { ...l, gradeRecipe: result.recipe } : l)),
    },
  }));
  useEditorStore.getState().notifyRender();
}

/**
 * Layer → Grade in Lopsy Photos. Call it from a click: Photos opens before
 * the layer is read. Does nothing in a build without Lopsy Photos.
 */
export async function gradeLayerInPhotos(layerId?: string): Promise<void> {
  const url = photosUrl();
  if (!url) return;
  const doc = useEditorStore.getState().document;
  const id = layerId ?? doc.activeLayerId;
  const layer = doc.layers.find((l) => l.id === id);
  if (!id || !layer || !canGradeLayer(layer)) {
    notifyError('Grade in Lopsy Photos works on an unlocked pixel layer.');
    return;
  }
  if (!getEngine()) {
    notifyError('Cannot grade: engine not ready.');
    return;
  }
  try {
    const pending = readGradeLayer(id, layer.name);
    const result = await gradeInPhotos({ photosUrl: url, layer: pending });
    if (result.kind === 'cancelled') return;
    const sent = await pending;
    applyGrade(id, result, { width: sent.width, height: sent.height });
    notifyInfo(`Graded “${layer.name}” in Lopsy Photos`);
  } catch (err) {
    notifyError(`Couldn't grade in Lopsy Photos: ${describeError(err)}`);
  }
}
