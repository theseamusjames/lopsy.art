/**
 * Grade in Photonamous (spec 6.12, L5): sends one raster layer to Photos'
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
import { decodeAndUploadImage, getLayerTextureDimensions } from '../../engine-wasm/wasm-bridge';
import { pngDimensions } from '@lopsy/handoff/messages';
import { photosUrl } from './photos-url';
import { blobSize, canGradeLayer } from './grade-checks';

export const GRADE_HISTORY_LABEL = 'Grade in Photonamous';

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
  // The user may have locked or resized the layer while it was being graded.
  if (!canGradeLayer(layer)) throw new Error(`“${layer.name}” was locked while it was being graded; it is unchanged.`);
  const current = getLayerTextureDimensions(engine, layerId);
  if (current[0] !== expected.width || current[1] !== expected.height) {
    throw new Error(`“${layer.name}” changed size while it was being graded; it is unchanged.`);
  }
  // Checked before the engine decodes anything: its decoder allocates what
  // the PNG header says, so a header claiming a huge image must never reach it.
  const size = pngDimensions(result.png);
  if (!size || size.width !== expected.width || size.height !== expected.height) {
    throw new Error(`the graded layer is ${size?.width ?? 0} × ${size?.height ?? 0}, not ${expected.width} × ${expected.height}.`);
  }

  useEditorStore.getState().pushHistory(GRADE_HISTORY_LABEL);
  decodeAndUploadImage(engine, layerId, new Uint8Array(result.png));
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
 * Layer → Grade in Photonamous. Call it from a click: Photos opens before
 * the layer is read. Does nothing in a build without Photonamous.
 */
export async function gradeLayerInPhotos(layerId?: string): Promise<void> {
  const url = photosUrl();
  if (!url) return;
  const doc = useEditorStore.getState().document;
  const id = layerId ?? doc.activeLayerId;
  const layer = doc.layers.find((l) => l.id === id);
  if (!id || !layer || !canGradeLayer(layer)) {
    notifyError('Grade in Photonamous works on an unlocked pixel layer.');
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
    notifyInfo(`Graded “${layer.name}” in Photonamous`);
  } catch (err) {
    notifyError(`Couldn't grade in Photonamous: ${describeError(err)}`);
  }
}
