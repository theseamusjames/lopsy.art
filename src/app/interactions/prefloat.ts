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
    selection: state.selection,
    gpuSnapshots,
    label: 'Move',
    paths: state.paths,
    selectedPathId: state.selectedPathId,
  };

  // Now float the selection
  const maskBytes = new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);
  setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);

  floatSelection(engine, layerId);
  compositeFloat(engine, 0, 0);

  // #802 — do NOT push the engine's expanded bounds into the Zustand
  // layer here. `update_layer` on the Rust side already protects x/y/
  // width/height while a float is active (see engine-rs
  // layer_manager.rs `update_layer`), so the engine keeps its expanded
  // state without needing the JS layer to lie. Writing the expanded
  // bounds into the store (previously just x=0, y=0 without touching
  // width/height) left the store describing a phantom rectangle at
  // the origin that Snap-to-Layers attracted drags to.
  //
  // If the user never actually drags, `clearSelection` will drop the
  // float and crop the engine back to content, leaving both sides in
  // agreement. If they do drag, `handleMoveMove` composites the float
  // and `handleMoveUp` translates the marching-ants; the JS layer
  // bounds get re-cropped on the next `cropLayerAndReadPosition`.

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
