import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { uploadLayerMaskIfChanged } from '../../engine-wasm/engine-sync';
import {
  releaseGpuSnapshot,
  remapLayerMask,
  restoreMaskFromGpuSnapshot,
  snapshotMaskGpu,
  type Engine,
} from '../../engine-wasm/wasm-bridge';
import { getMasksMovedWithLayers } from '../../layers/mask-origin';
import { markMaskDataStale, scheduleMaskDataRefresh } from '../mask-data-sync';

/**
 * Raster and group masks are anchored at the document origin, so moving a
 * layer by `x`/`y` alone leaves its mask behind (#1504). A whole-layer move
 * therefore translates those masks on the GPU as well.
 *
 * A drag snapshots each mask once and redraws it from that snapshot at the
 * drag's total offset, so mask content pushed off the canvas comes back
 * when the drag returns. Area the old mask never covered reads as revealed,
 * the same as outside a mask.
 */

interface FollowedMask {
  readonly layerId: string;
  readonly width: number;
  readonly height: number;
  readonly snapshot: number;
}

interface MaskFollowSession {
  readonly engine: Engine;
  readonly masks: readonly FollowedMask[];
}

/** `snapshotMaskGpu`'s answer for a layer with no mask on the engine. */
const EMPTY_SNAPSHOT = 0xFFFFFFFF;

let session: MaskFollowSession | null = null;

function translateMask(engine: Engine, layerId: string, width: number, height: number, dx: number, dy: number): void {
  remapLayerMask(engine, layerId, width, height, 1, 0, 0, 1, -dx, -dy);
}

/** Masks of `movedIds`, uploaded so the GPU copy is current before it is written. */
function prepareMasks(engine: Engine, movedIds: readonly string[]): { id: string; width: number; height: number }[] {
  const layers = useEditorStore.getState().document.layers;
  const result: { id: string; width: number; height: number }[] = [];
  for (const id of getMasksMovedWithLayers(layers, movedIds)) {
    const mask = layers.find((l) => l.id === id)?.mask;
    if (!mask) continue;
    uploadLayerMaskIfChanged(engine, id, mask.data, mask.width, mask.height);
    markMaskDataStale(id);
    result.push({ id, width: mask.width, height: mask.height });
  }
  return result;
}

/** Start carrying the masks of `movedIds` through a whole-layer drag. */
export function beginMaskFollow(movedIds: readonly string[]): void {
  endMaskFollow();
  const engine = getEngine();
  if (!engine) return;
  const masks: FollowedMask[] = [];
  for (const { id, width, height } of prepareMasks(engine, movedIds)) {
    const snapshot = snapshotMaskGpu(engine, id);
    if (snapshot === EMPTY_SNAPSHOT) continue;
    masks.push({ layerId: id, width, height, snapshot });
  }
  session = { engine, masks };
}

export function isMaskFollowActive(): boolean {
  return session !== null;
}

/** Place every followed mask at the drag's total offset from where it started. */
export function applyMaskFollow(dx: number, dy: number): void {
  if (!session) return;
  for (const m of session.masks) {
    restoreMaskFromGpuSnapshot(session.engine, m.layerId, m.snapshot);
    if (dx !== 0 || dy !== 0) translateMask(session.engine, m.layerId, m.width, m.height, dx, dy);
  }
}

/** Finish the drag: free the snapshots and refresh the JS mask bytes lazily. */
export function endMaskFollow(): void {
  if (!session) return;
  for (const m of session.masks) {
    releaseGpuSnapshot(session.engine, m.snapshot);
    scheduleMaskDataRefresh(m.layerId);
  }
  session = null;
}

/** One-shot translate for an arrow-key nudge of `movedIds`. */
export function translateMasksWithLayers(movedIds: readonly string[], dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const engine = getEngine();
  if (!engine) return;
  for (const { id, width, height } of prepareMasks(engine, movedIds)) {
    translateMask(engine, id, width, height, dx, dy);
    scheduleMaskDataRefresh(id);
  }
}
