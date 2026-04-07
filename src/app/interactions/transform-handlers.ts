import {
  hitTestHandle,
  isScaleHandle,
  isRotateHandle,
  computeScale,
  computeRotation,
  computeSkew,
  computeDistort,
  computePerspective,
  getCornerPositions,
  computeInverseAffineMatrix,
} from '../../tools/transform/transform';
import type { TransformState } from '../../tools/transform/transform';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floatSelection,
  hasFloat,
  setSelectionMask,
  compositeFloatAffine,
  compositeFloatPerspective,
} from '../../engine-wasm/wasm-bridge';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import type { InteractionState, InteractionContext } from './interaction-types';
import type { Point } from '../../types';

/**
 * Hit-test transform handles on mousedown and set up interaction state.
 * Returns InteractionState if a handle was hit, null otherwise (so the
 * caller can fall through to the tool switch).
 */
export function handleTransformDown(ctx: InteractionContext): InteractionState | null {
  const { canvasPos, activeLayerId, floatingSelectionRef, persistentTransformRef } = ctx;

  const uiState = useUIStore.getState();
  const currentTransform = uiState.transform;
  const editorState = useEditorStore.getState();

  if (!currentTransform || !editorState.selection.active) {
    return null;
  }

  const handleRadius = 8 / editorState.viewport.zoom;
  const hit = hitTestHandle(canvasPos, currentTransform, handleRadius);

  if (!hit) {
    return null;
  }

  const startAngle = isRotateHandle(hit)
    ? computeRotation(canvasPos, currentTransform) - currentTransform.rotation
    : 0;

  editorState.pushHistory();

  // Clear floating selection ref when entering transform mode.
  floatingSelectionRef.current = null;

  const engine = getEngine();

  // If there's a GPU float from a previous move (no persistentTransformRef),
  // commit it first so we start the transform from committed content.
  if (engine && hasFloat(engine) && !persistentTransformRef.current) {
    selectLayerAlpha(activeLayerId);
    // Force-sync mask to GPU
    const selAfter = useEditorStore.getState().selection;
    if (selAfter.active && selAfter.mask) {
      const maskBytes = new Uint8Array(selAfter.mask.buffer, selAfter.mask.byteOffset, selAfter.mask.byteLength);
      setSelectionMask(engine, maskBytes, selAfter.maskWidth, selAfter.maskHeight);
    }
  }

  // If the float was dropped (e.g., by selectLayerAlpha or cmd+click),
  // clear stale persistentTransformRef so we re-float.
  if (engine && !hasFloat(engine)) {
    persistentTransformRef.current = null;
  }

  // Re-read selection after potential commit
  const sel = useEditorStore.getState().selection;

  if (!persistentTransformRef.current && sel.active && sel.mask) {
    if (engine && !hasFloat(engine)) {
      // Ensure selection mask is on the GPU before floating, otherwise
      // floatSelection extracts the entire layer instead of just the
      // selected pixels.
      const maskBytes = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
      setSelectionMask(engine, maskBytes, sel.maskWidth, sel.maskHeight);

      floatSelection(engine, activeLayerId);

      clearJsPixelData(activeLayerId);
    }

    persistentTransformRef.current = {
      originalMask: new Uint8ClampedArray(sel.mask),
      maskWidth: sel.maskWidth,
      maskHeight: sel.maskHeight,
    };
  }

  const persistent = persistentTransformRef.current;
  const activeTool = uiState.activeTool;

  const newState: InteractionState = {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: activeTool,
    startPoint: canvasPos,
    layerStartX: 0,
    layerStartY: 0,
    maskMode: false,
    transformHandle: hit,
    transformStartState: { ...currentTransform },
    transformStartAngle: startAngle,
    originalSelectionMask: persistent?.originalMask ?? null,
    originalSelectionMaskWidth: persistent?.maskWidth ?? 0,
    originalSelectionMaskHeight: persistent?.maskHeight ?? 0,
    moveOriginalMask: null,
    moveOriginalBounds: null,
  };

  uiState.setActiveTransformHandle(hit);

  return newState;
}

/**
 * Handle transform drag (scale / rotate / skew / distort / perspective)
 * during mousemove. Computes the new transform, updates the UI store,
 * transforms the selection mask, and renders the transform via the GPU engine.
 */
export function handleTransformMove(
  state: InteractionState,
  canvasPos: Point,
  shiftKey: boolean,
): void {
  if (!state.transformHandle || !state.transformStartState || !state.startPoint) {
    return;
  }

  const handle = state.transformHandle;
  const startState = state.transformStartState;

  let newTransform: TransformState;

  if (startState.mode === 'distort' && isScaleHandle(handle)) {
    const result = computeDistort(handle, state.startPoint, canvasPos, startState);
    newTransform = { ...startState, corners: result.corners };
  } else if (startState.mode === 'perspective' && isScaleHandle(handle)) {
    const result = computePerspective(handle, state.startPoint, canvasPos, startState);
    newTransform = { ...startState, corners: result.corners };
  } else if (startState.mode === 'skew' && isScaleHandle(handle)) {
    const result = computeSkew(handle, state.startPoint, canvasPos, startState);
    newTransform = {
      ...startState,
      skewX: result.skewX,
      skewY: result.skewY,
      translateX: result.translateX,
      translateY: result.translateY,
    };
  } else if (isScaleHandle(handle)) {
    const uiSnap = useUIStore.getState();
    const snapEnabled = uiSnap.showGrid && uiSnap.snapToGrid;
    const snappedInput = snapEnabled
      ? { x: Math.round(canvasPos.x / uiSnap.gridSize) * uiSnap.gridSize, y: Math.round(canvasPos.y / uiSnap.gridSize) * uiSnap.gridSize }
      : canvasPos;
    const result = computeScale(
      handle,
      state.startPoint,
      snappedInput,
      startState,
      shiftKey,
    );
    newTransform = {
      ...startState,
      scaleX: result.scaleX,
      scaleY: result.scaleY,
      translateX: result.translateX,
      translateY: result.translateY,
    };
  } else {
    const currentAngle = computeRotation(canvasPos, startState);
    const newRotation = currentAngle - state.transformStartAngle;
    const uiState = useUIStore.getState();
    const shouldSnap = shiftKey || (uiState.showGrid && uiState.snapToGrid);
    const snappedRotation = shouldSnap
      ? Math.round(newRotation / (Math.PI / 12)) * (Math.PI / 12)
      : newRotation;
    newTransform = {
      ...startState,
      rotation: snappedRotation,
    };
  }

  useUIStore.getState().setTransform(newTransform);

  // Don't update the selection mask during drag — the transform handles
  // show the correct bounding box, and the mask gets rebuilt from pixel
  // alpha on commit (via selectLayerAlpha). Updating the mask during drag
  // causes it to diverge from the GPU-rendered content.

  // Render transform via GPU engine
  const editorState = useEditorStore.getState();
  const engine = getEngine();
  if (engine && hasFloat(engine)) {
    const isCornerMode = newTransform.mode === 'distort' || newTransform.mode === 'perspective';

    if (isCornerMode) {
      const [tl, tr, br, bl] = getCornerPositions(newTransform);
      const corners = new Float32Array([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
      const ob = newTransform.originalBounds;
      compositeFloatPerspective(engine, corners, ob.x, ob.y, ob.width, ob.height);
    } else {
      const ob = newTransform.originalBounds;
      const srcCx = ob.x + ob.width / 2;
      const srcCy = ob.y + ob.height / 2;
      const dstCx = srcCx + newTransform.translateX;
      const dstCy = srcCy + newTransform.translateY;
      const invMatrix = computeInverseAffineMatrix(newTransform);
      compositeFloatAffine(engine, invMatrix, srcCx, srcCy, dstCx, dstCy);
    }
  }

  editorState.notifyRender();
}
