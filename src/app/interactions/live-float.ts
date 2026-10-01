import type { MutableRefObject } from 'react';
import type { FloatingSelection, PersistentTransform } from './interaction-types';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { reconcileLayerBoundsWithEngine } from '../reconcile-layer-bounds';
import { getEngine } from '../../engine-wasm/engine-state';
import { hasFloat, dropFloat, setSelectionMask } from '../../engine-wasm/wasm-bridge';
import { applyTransformToMask, createTransformState, isShapeChangingTransform } from '../../tools/transform/transform';
import { cancelPrefloat, commitUnmovedPrefloat } from './prefloat';

/**
 * The Move tool keeps the pixels it lifted floating after a drag or handle
 * drag, so the next drag carries the same piece and a rotate re-derives from
 * the untouched original. That float is only a cache of what is on screen:
 * the layer texture already holds its composite. Anything else that edits
 * the layer, replaces the selection or changes the active layer makes it
 * stale, so it is baked in first and the next Move gesture lifts afresh.
 */

interface FloatSessionRefs {
  floating: MutableRefObject<FloatingSelection | null>;
  persistent: MutableRefObject<PersistentTransform | null>;
}

/** The layer the Move tool's float was lifted from and the selection that frames it. */
interface FloatOwner {
  layerId: string;
  mask: Uint8ClampedArray;
}

let session: FloatSessionRefs | null = null;
let owner: FloatOwner | null = null;
let keepDepth = 0;
let isCommitting = false;

/** Hand the canvas interaction's float refs to this module. Returns the unregister. */
export function registerFloatSession(
  floating: MutableRefObject<FloatingSelection | null>,
  persistent: MutableRefObject<PersistentTransform | null>,
): () => void {
  const registered: FloatSessionRefs = { floating, persistent };
  session = registered;
  return () => {
    if (session === registered) session = null;
  };
}

/** Record that the live float on `layerId` is framed by the selection `mask`. */
export function claimLiveFloat(layerId: string, mask: Uint8ClampedArray): void {
  owner = { layerId, mask };
}

/** Whether the Move tool's float is still the one on screen for `layerId`. */
export function isLiveFloatCurrent(layerId: string): boolean {
  if (!owner) return false;
  const engine = getEngine();
  if (!engine || !hasFloat(engine)) return false;
  const state = useEditorStore.getState();
  return owner.layerId === layerId
    && state.document.activeLayerId === layerId
    && state.selection.mask === owner.mask;
}

/**
 * Bake a Move-tool float that no longer matches what is on screen, so the
 * caller lifts the current selection afresh. A float that still matches is
 * left alone.
 */
export function releaseStaleMoveFloat(layerId: string): void {
  const hasSession = owner !== null
    || session?.floating.current != null
    || session?.persistent.current != null;
  if (hasSession && !isLiveFloatCurrent(layerId)) commitMoveFloat();
}

/**
 * Run `fn` (the Move tool's own history push) without baking the float it is
 * about to keep using.
 */
export function withLiveFloatKept(fn: () => void): void {
  keepDepth++;
  try {
    fn();
  } finally {
    keepDepth--;
  }
}

/**
 * Bake whatever float is live into its layer: the Move tool's (with any
 * pending scale or rotate applied to the selection, so the marquee keeps
 * matching the pixels), an unmoved prefloat, or any other leftover. The
 * selection the user sees is kept.
 */
export function commitLiveFloat(): void {
  commitMoveFloat();
  commitUnmovedPrefloat();
  cancelPrefloat();
  const engine = getEngine();
  if (!engine || !hasFloat(engine)) return;
  dropFloat(engine);
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (activeId) reconcileLayerBoundsWithEngine(engine, activeId);
}

/** Called before every pixel history push: the edit that follows must not be undone by the float. */
export function commitLiveFloatBeforeEdit(): void {
  if (keepDepth > 0) return;
  commitLiveFloat();
}

/** Forget the Move tool's float without baking it (undo/redo restore the pixels themselves). */
export function forgetLiveFloat(): void {
  owner = null;
  if (session) {
    session.floating.current = null;
    session.persistent.current = null;
  }
}

function commitMoveFloat(): void {
  if (isCommitting) return;
  isCommitting = true;
  try {
    const committed = owner;
    const hadTransform = session?.persistent.current != null;
    const hadSession = committed !== null || hadTransform || session?.floating.current != null;
    forgetLiveFloat();
    const engine = getEngine();
    if (!hadSession || !engine || !hasFloat(engine)) return;

    const editor = useEditorStore.getState();
    const layerId = committed?.layerId ?? editor.document.activeLayerId;
    if (hadTransform && committed && editor.selection.mask === committed.mask) {
      bakeTransformIntoSelection();
    }
    dropFloat(engine);
    if (layerId) {
      reconcileLayerBoundsWithEngine(engine, layerId);
      clearJsPixelData(layerId);
    }
    uploadSelectionMask();
    useEditorStore.getState().notifyRender();
  } finally {
    isCommitting = false;
  }
}

/**
 * While a scale or rotate is pending the store keeps the untransformed mask
 * and the ants draw it through `uiStore.transform`. Once the float is gone
 * that transform has nothing left to apply to, so the mask takes it on.
 */
function bakeTransformIntoSelection(): void {
  const transform = useUIStore.getState().transform;
  const editor = useEditorStore.getState();
  const sel = editor.selection;
  if (!sel.active || !sel.mask || !transform || !isShapeChangingTransform(transform)) return;
  const { mask, bounds } = applyTransformToMask(sel.mask, sel.maskWidth, sel.maskHeight, transform);
  if (!bounds) return;
  editor.setSelection(bounds, mask, sel.maskWidth, sel.maskHeight);
  useUIStore.getState().setTransform(createTransformState(bounds, transform.mode));
}

/** The very next operation may read the GPU mask before engine-sync's frame does. */
function uploadSelectionMask(): void {
  const engine = getEngine();
  const sel = useEditorStore.getState().selection;
  if (!engine || !sel.active || !sel.mask) return;
  const bytes = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
  setSelectionMask(engine, bytes, sel.maskWidth, sel.maskHeight);
}
