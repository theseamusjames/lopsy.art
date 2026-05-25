import { getEngine } from '../../engine-wasm/engine-state';
import {
  floatSelection,
  compositeFloat,
  setSelectionMask,
  hasFloat,
  snapshotLayerGpu,
  releaseGpuSnapshot,
} from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { useEditorStore } from '../editor-store';
import type { HistorySnapshot } from '../store/types';
import type { Rect } from '../../types';

interface PrefloatState {
  layerId: string;
  mask: Uint8ClampedArray;
  bounds: Rect;
  snapshot: HistorySnapshot;
}

let prefloat: PrefloatState | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePrefloat(layerId: string, mask: Uint8ClampedArray, bounds: Rect): void {
  cancelPrefloat();
  const capturedMask = mask;
  const capturedBounds = bounds;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    executePrefloat(layerId, capturedMask, capturedBounds);
  }, 0);
}

function executePrefloat(layerId: string, mask: Uint8ClampedArray, bounds: Rect): void {
  const engine = getEngine();
  if (!engine) return;

  const sel = useEditorStore.getState().selection;
  if (!sel.active || sel.mask !== mask) return;

  if (hasFloat(engine)) return;

  // Build undo snapshot BEFORE floating (captures the pre-float state).
  const state = useEditorStore.getState();
  const gpuSnapshots = new Map<string, number>();
  for (const lid of state.document.layerOrder) {
    const handle = snapshotLayerGpu(engine, lid);
    gpuSnapshots.set(lid, handle);
  }
  const snapshot: HistorySnapshot = {
    kind: 'pixels',
    document: state.document,
    gpuSnapshots,
    label: 'Move',
  };

  // Now float the selection
  const maskBytes = new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);
  setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);

  const result = floatSelection(engine, layerId);
  compositeFloat(engine, 0, 0);

  if (result.length >= 4) {
    const newX = result[0]!;
    const newY = result[1]!;
    const curLayer = useEditorStore.getState().document.layers.find(l => l.id === layerId);
    if (curLayer && (curLayer.x !== newX || curLayer.y !== newY)) {
      useEditorStore.getState().updateLayerPosition(layerId, newX, newY);
    }
  }

  clearJsPixelData(layerId);
  useEditorStore.getState().notifyRender();

  prefloat = { layerId, mask, bounds, snapshot };
}

export function consumePrefloat(layerId: string, currentMask: Uint8ClampedArray | null): PrefloatState | null {
  if (!prefloat) return null;
  if (prefloat.layerId !== layerId) return null;
  if (prefloat.mask !== currentMask) return null;

  const engine = getEngine();
  if (!engine || !hasFloat(engine)) {
    releasePrefloat();
    return null;
  }

  const result = prefloat;
  prefloat = null;
  return result;
}

function releasePrefloat(): void {
  if (prefloat) {
    const engine = getEngine();
    if (engine && prefloat.snapshot.kind === 'pixels') {
      for (const handle of prefloat.snapshot.gpuSnapshots.values()) {
        releaseGpuSnapshot(engine, handle);
      }
    }
    prefloat = null;
  }
}

export function cancelPrefloat(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  releasePrefloat();
}
