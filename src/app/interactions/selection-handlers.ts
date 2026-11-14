import type { InteractionState, InteractionContext } from './interaction-types';
import type { Point } from '../../types';
import type { SelectionToolId } from './selection-strategy';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import {
  createRectSelection as tsCreateRectSelection,
  createEllipseSelection as tsCreateEllipseSelection,
  selectionBounds as tsSelectionBounds,
  combineSelections as tsCombineSelections,
  SELECTION_COMBINE_LABELS,
  type SelectionCombineMode,
  type SelectionCombineOp,
} from '../../selection/selection';
import { getEngine } from '../../engine-wasm/engine-state';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import {
  createRectSelection as wasmCreateRectSelection,
  createEllipseSelection as wasmCreateEllipseSelection,
  selectionBounds as wasmSelectionBounds,
  createPolygonMask as wasmCreatePolygonMask,
  setSelectionMask,
  featherSelectionMask,
  readSelectionMask,
  combineSelections as wasmCombineSelections,
} from '../../engine-wasm/wasm-bridge';
import { seedSelectionMaskRef } from '../../engine-wasm/sync-state';
import { createPolygonMask as tsCreatePolygonMask } from '../../tools/lasso/lasso';
import { createTransformState } from '../../tools/transform/transform';
import { marqueeStrategy } from '../../tools/marquee/marquee-strategy';
import { wandStrategy } from '../../tools/wand/wand-strategy';
import { lassoStrategy } from '../../tools/lasso/lasso-strategy';
import { magneticLassoStrategy } from '../../tools/magnetic-lasso/magnetic-lasso-strategy';
import type { SelectionToolStrategy } from './selection-strategy';

const STRATEGY_MAP: Record<SelectionToolId, SelectionToolStrategy> = {
  'marquee-rect': marqueeStrategy,
  'marquee-ellipse': marqueeStrategy,
  'wand': wandStrategy,
  'lasso': lassoStrategy,
  'lasso-magnetic': magneticLassoStrategy,
};

// ── Shared helpers used by strategies ────────────────────────────────────

export function constrainMarqueeSize(
  rawW: number,
  rawH: number,
  options: {
    metaPressed: boolean;
    aspectRatioLocked: boolean;
    aspectRatioW: number;
    aspectRatioH: number;
  },
): { w: number; h: number } {
  const w0 = Math.abs(rawW);
  const h0 = Math.abs(rawH);
  const useLock = options.metaPressed
    || (options.aspectRatioLocked && options.aspectRatioW > 0 && options.aspectRatioH > 0);
  if (!useLock) return { w: w0, h: h0 };
  const ratio = options.metaPressed
    ? 1
    : options.aspectRatioW / options.aspectRatioH;
  if (h0 === 0) return { w: 0, h: 0 };
  if (w0 / h0 > ratio) {
    return { w: h0 * ratio, h: h0 };
  }
  return { w: w0, h: w0 / ratio };
}

export interface FeatheredMask {
  mask: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Feather `mask` on the GPU and read the result. The feathered bytes are
 * left in the engine's selection texture. Null when the read came back
 * empty.
 */
export async function featherMaskOnGpu(
  engine: Engine,
  mask: Uint8ClampedArray,
  docW: number,
  docH: number,
  radius: number,
): Promise<FeatheredMask | null> {
  const u8Mask = new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);
  setSelectionMask(engine, u8Mask, docW, docH);
  featherSelectionMask(engine, radius);
  const readback = await readSelectionMask(engine);
  if (readback.length < 8) return null;
  const dv = new DataView(readback.buffer, readback.byteOffset, readback.byteLength);
  const width = dv.getUint32(0, true);
  const height = dv.getUint32(4, true);
  return {
    mask: new Uint8ClampedArray(readback.buffer, readback.byteOffset + 8, width * height),
    width,
    height,
  };
}

/**
 * Feather a freshly built shape mask with the marquees' shared Feather
 * radius. Returns null, at once, when there is nothing to feather (radius
 * 0 or no engine); the promise resolves to null when the feather wiped the
 * shape out.
 */
function featherShapeMask(
  mask: Uint8ClampedArray,
  docW: number,
  docH: number,
): Promise<FeatheredMask | null> | null {
  const featherRadius = useToolSettingsStore.getState().settings.marquee.feather;
  if (featherRadius <= 0) return null;
  const engine = getEngine();
  if (!engine) return null;
  return featherMaskOnGpu(engine, mask, docW, docH, featherRadius).catch(() => null);
}

let latestFeatherCommit = 0;

/**
 * Run `apply` with the feathered shape once it has been read. A selection
 * made in the meantime, feathered or not, replaces this one: its result
 * is dropped rather than installed over the newer selection.
 */
function whenFeathered(
  pending: Promise<FeatheredMask | null>,
  apply: (feathered: FeatheredMask | null) => void,
): void {
  const commit = ++latestFeatherCommit;
  const selectionAtRequest = useEditorStore.getState().selection.mask;
  void pending.then((feathered) => {
    if (commit !== latestFeatherCommit) return;
    if (useEditorStore.getState().selection.mask !== selectionAtRequest) return;
    apply(feathered);
  });
}

function installSelection(
  bounds: { x: number; y: number; width: number; height: number },
  mask: Uint8ClampedArray,
  docW: number,
  docH: number,
): void {
  useEditorStore.getState().setSelection(bounds, mask, docW, docH);
  useUIStore.getState().setTransform(createTransformState(bounds));
}

export function commitFeatheredSelection(
  bounds: { x: number; y: number; width: number; height: number },
  mask: Uint8ClampedArray,
  docW: number,
  docH: number,
): void {
  const pending = featherShapeMask(mask, docW, docH);
  if (!pending) {
    installSelection(bounds, mask, docW, docH);
    return;
  }
  whenFeathered(pending, (feathered) => {
    const newBounds = feathered ? selectionBounds(feathered.mask, feathered.width, feathered.height) : null;
    if (!feathered || !newBounds) {
      installSelection(bounds, mask, docW, docH);
      return;
    }
    installSelection(newBounds, feathered.mask, feathered.width, feathered.height);
    // #763: the feathered bytes were just written to the GPU by
    // featherSelectionMask — record them as the tracked reference so
    // the next syncSelection skips the echo upload.
    const engine = getEngine();
    if (engine) seedSelectionMaskRef(engine, feathered.mask);
  });
}

/** The selection mask a new shape can combine with, if one is active. */
function combinableSelectionMask(docW: number, docH: number): Uint8ClampedArray | null {
  const sel = useEditorStore.getState().selection;
  if (!sel.active || !sel.mask || sel.maskWidth !== docW || sel.maskHeight !== docH) return null;
  return sel.mask;
}

/** Whether a gesture starting now has a selection to add to or subtract from. */
export function hasCombinableSelection(): boolean {
  const { width, height } = useEditorStore.getState().document;
  return combinableSelectionMask(width, height) !== null;
}

const COMBINE_MODE_CODE: Readonly<Record<SelectionCombineOp, number>> = {
  add: 1,
  subtract: 2,
  intersect: 3,
};

export function combineSelectionMasks(
  existing: Uint8ClampedArray,
  shape: Uint8ClampedArray,
  op: SelectionCombineOp,
): Uint8ClampedArray {
  try {
    const result = wasmCombineSelections(
      new Uint8Array(existing.buffer, existing.byteOffset, existing.byteLength),
      new Uint8Array(shape.buffer, shape.byteOffset, shape.byteLength),
      COMBINE_MODE_CODE[op],
    );
    return new Uint8ClampedArray(result.buffer, result.byteOffset, result.byteLength);
  } catch {
    return tsCombineSelections(existing, shape, op);
  }
}

/**
 * Commit a selection tool's new shape. `replace` installs it as the
 * selection; the other modes combine it with the current selection as one
 * undoable step. Feather softens only the new shape, so adding a region
 * never re-blurs the edges already selected.
 */
export function commitSelectionShape(
  bounds: { x: number; y: number; width: number; height: number },
  mask: Uint8ClampedArray,
  docW: number,
  docH: number,
  mode: SelectionCombineMode,
): void {
  const existing = mode === 'replace' ? null : combinableSelectionMask(docW, docH);
  if (mode === 'replace' || !existing) {
    commitFeatheredSelection(bounds, mask, docW, docH);
    return;
  }
  useEditorStore.getState().pushHistoryMetadata(SELECTION_COMBINE_LABELS[mode]);
  const combineWith = (feathered: FeatheredMask | null): void => {
    const shape = feathered && feathered.width === docW && feathered.height === docH ? feathered.mask : mask;
    const combined = combineSelectionMasks(existing, shape, mode);
    const combinedBounds = selectionBounds(combined, docW, docH);
    if (!combinedBounds) {
      useEditorStore.getState().clearSelection();
      useUIStore.getState().setTransform(null);
      return;
    }
    installSelection(combinedBounds, combined, docW, docH);
  };
  const pending = featherShapeMask(mask, docW, docH);
  if (pending) whenFeathered(pending, combineWith);
  else combineWith(null);
}

export function createRectSelection(
  rect: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): Uint8ClampedArray {
  try {
    const result = wasmCreateRectSelection(
      canvasWidth, canvasHeight,
      Math.floor(rect.x), Math.floor(rect.y),
      Math.ceil(rect.width), Math.ceil(rect.height),
    );
    return new Uint8ClampedArray(result);
  } catch {
    return tsCreateRectSelection(rect, canvasWidth, canvasHeight);
  }
}

export function createEllipseSelection(
  rect: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): Uint8ClampedArray {
  try {
    const result = wasmCreateEllipseSelection(
      canvasWidth, canvasHeight,
      Math.floor(rect.x), Math.floor(rect.y),
      Math.ceil(rect.width), Math.ceil(rect.height),
    );
    return new Uint8ClampedArray(result);
  } catch {
    return tsCreateEllipseSelection(rect, canvasWidth, canvasHeight);
  }
}

export function selectionBounds(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | null {
  try {
    const u8Mask = new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);
    const result = wasmSelectionBounds(u8Mask, width, height);
    if (result.length < 4) return null;
    return { x: result[0]!, y: result[1]!, width: result[2]!, height: result[3]! };
  } catch {
    return tsSelectionBounds(mask, width, height);
  }
}

export function createPolygonMask(
  points: Point[],
  width: number,
  height: number,
): Uint8ClampedArray {
  try {
    const flat = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = points[i]!.x;
      flat[i * 2 + 1] = points[i]!.y;
    }
    const result = wasmCreatePolygonMask(flat, width, height);
    return new Uint8ClampedArray(result);
  } catch {
    return tsCreatePolygonMask(points, width, height);
  }
}

// ── Dispatchers ──────────────────────────────────────────────────────────

export function handleSelectionDown(
  ctx: InteractionContext,
  tool: SelectionToolId,
): InteractionState | undefined {
  return STRATEGY_MAP[tool].onDown(ctx, tool);
}

export function handleSelectionMove(
  state: InteractionState,
  canvasPos: Point,
  metaKey = false,
): void {
  const tool = state.tool as SelectionToolId;
  STRATEGY_MAP[tool]?.onMove?.(state, canvasPos, metaKey);
}

export function handleSelectionUp(
  state: InteractionState,
  _canvasPos: Point,
  screenToCanvas: (sx: number, sy: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
  e: { clientX: number; clientY: number },
): void {
  const tool = state.tool as SelectionToolId;
  STRATEGY_MAP[tool]?.onUp?.(state, _canvasPos, { screenToCanvas, containerRef, event: e });
}
