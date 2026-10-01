import type { Point, TextLayer } from '../../types';
import type { SelectionData } from '../store/types';
import type { InteractionContext, InteractionState } from './interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from './interaction-types';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { hasFloat } from '../../engine-wasm/wasm-bridge';
import { measureTextFrame } from '../../engine-wasm/engine-sync';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { captureLayerGpu, releaseLayerGpu } from '../store/layer-gpu-capture';
import { isLayerAlphaSelection, selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import { notifyInfo } from '../notifications-store';
import { coalesceToAnimationFrame } from '../../utils/raf-coalesce';
import type { TransformHandle, TransformState } from '../../tools/transform/transform';
import {
  applyMatrix,
  dragTextFrame,
  transformStateFromFrame,
  type TextFrame,
} from '../../tools/text/text-transform';
import { hitTestTransformHandle } from './transform-handlers';
import { renderTextLayerPlacement, transformableTextLayer } from '../text-layer-transform';

/** The text layer the Move tool shows handles for, with its frame and handle state. */
export interface TextTransformTarget {
  readonly layer: TextLayer;
  readonly frame: TextFrame;
  readonly state: TransformState;
}

/** Where the drag in progress has put the text, so the box follows the pointer. */
let liveDrag: { layerId: string; frame: TextFrame } | null = null;

/** Samples per axis when checking that a selection covers a text layer. */
const COVER_SAMPLES = 9;
/** Fraction of the layout box left out at each edge of that check. */
const COVER_INSET = 0.05;

/**
 * True when the selection takes in the whole text layer: it is the layer's
 * own alpha (⌘-click on the thumbnail) or it covers the layer's layout box.
 * Points of the box past the canvas edge are ignored — a document-sized mask
 * can't hold them.
 */
export function selectionCoversTextFrame(
  selection: SelectionData,
  layerId: string,
  frame: TextFrame,
): boolean {
  if (!selection.active || !selection.mask) return false;
  if (isLayerAlphaSelection(layerId, selection.mask)) return true;
  const { box } = frame;
  const { mask, maskWidth, maskHeight } = selection;
  for (let iy = 0; iy < COVER_SAMPLES; iy++) {
    for (let ix = 0; ix < COVER_SAMPLES; ix++) {
      const u = COVER_INSET + (1 - 2 * COVER_INSET) * (ix / (COVER_SAMPLES - 1));
      const v = COVER_INSET + (1 - 2 * COVER_INSET) * (iy / (COVER_SAMPLES - 1));
      const p = applyMatrix(frame.matrix, { x: box.x + u * box.width, y: box.y + v * box.height });
      const x = Math.floor(p.x + frame.anchor.x);
      const y = Math.floor(p.y + frame.anchor.y);
      if (x < 0 || y < 0 || x >= maskWidth || y >= maskHeight) continue;
      if ((mask[y * maskWidth + x] ?? 0) < 128) return false;
    }
  }
  return true;
}

/**
 * The active text layer the Move tool should show transform handles around,
 * or null. Text keeps its handles with no selection, or with a selection
 * that takes in the whole layer; a lifted float owns the layer until it is
 * committed.
 */
export function getTextTransformTarget(): TextTransformTarget | null {
  const ui = useUIStore.getState();
  if (ui.activeTool !== 'move' || ui.textEditing || ui.maskMode === 'quickMask') return null;
  const editor = useEditorStore.getState();
  const layer = transformableTextLayer(editor.document.activeLayerId);
  if (!layer || !layer.visible || layer.locked) return null;
  if ((editor.document.selectedLayerIds?.length ?? 0) > 1) return null;
  const engine = getEngine();
  if (!engine || hasFloat(engine)) return null;
  const measured = measureTextFrame(engine, layer);
  if (!measured) return null;
  if (editor.selection.active && !selectionCoversTextFrame(editor.selection, layer.id, measured)) return null;
  const frame = liveDrag?.layerId === layer.id ? liveDrag.frame : measured;
  return { layer, frame, state: transformStateFromFrame(frame, ui.textTransformMode) };
}

export const PARTIAL_TEXT_MOVE_HINT = 'Rasterize the text layer to move or transform part of it.';

/**
 * True when the Move tool would lift only part of the active text layer: its
 * pixels would be baked into a texture the next text re-render throws away.
 */
export function isPartialTextMove(): boolean {
  const ui = useUIStore.getState();
  if (ui.activeTool !== 'move' || ui.maskMode === 'quickMask') return false;
  const editor = useEditorStore.getState();
  const layer = editor.document.layers.find((l) => l.id === editor.document.activeLayerId);
  if (!layer || layer.type !== 'text' || !editor.selection.active) return false;
  const engine = getEngine();
  if (!engine || hasFloat(engine)) return false;
  const frame = layer.pathId ? null : measureTextFrame(engine, layer);
  return !(frame && selectionCoversTextFrame(editor.selection, layer.id, frame));
}

/**
 * Refuse a partial text-layer move ({@link isPartialTextMove}) with a hint.
 */
export function refusePartialTextMove(): boolean {
  if (!isPartialTextMove()) return false;
  notifyInfo(PARTIAL_TEXT_MOVE_HINT);
  return true;
}

/**
 * Start a handle drag on the active text layer, or return null when the
 * pointer is not on one of its handles.
 */
export function handleTextTransformDown(ctx: InteractionContext): InteractionState | null {
  const target = getTextTransformTarget();
  if (!target) return null;
  const editor = useEditorStore.getState();
  const hit = hitTestTransformHandle(ctx.canvasPos, target.state, editor.viewport.zoom);
  if (!hit) return null;

  const { layer, frame } = target;
  // Any cached JS copy of the old glyphs would be re-uploaded over the render.
  clearJsPixelData(layer.id);
  const before = { layer, gpuHandle: captureLayerGpu(layer.id) };
  liveDrag = { layerId: layer.id, frame };
  useUIStore.getState().setActiveTransformHandle(hit);

  return {
    ...DEFAULT_TRANSFORM_FIELDS,
    drawing: true,
    gesture: {
      kind: 'textTransform',
      handle: hit,
      startFrame: frame,
      before,
      reselectAlpha: editor.selection.active,
    },
    lastPoint: ctx.canvasPos,
    layerId: layer.id,
    tool: 'move',
    startPoint: ctx.canvasPos,
    layerStartX: 0,
    layerStartY: 0,
  };
}

interface TextTransformStep {
  layerId: string;
  startFrame: TextFrame;
  handle: TransformHandle;
  startPoint: Point;
  canvasPos: Point;
  metaKey: boolean;
}

function applyTextTransformStep(step: TextTransformStep): void {
  const layer = transformableTextLayer(step.layerId);
  if (!layer) return;
  const ui = useUIStore.getState();
  const placement = dragTextFrame(step.startFrame, step.handle, step.startPoint, step.canvasPos, {
    mode: ui.textTransformMode,
    isProportional: step.metaKey,
    shouldSnapAngle: step.metaKey || (ui.showGrid && ui.snapToGrid),
  });
  // A degenerate drag keeps the last good placement.
  if (!placement || !renderTextLayerPlacement(layer, placement)) return;
  liveDrag = { layerId: step.layerId, frame: { ...placement, box: step.startFrame.box } };
  useEditorStore.getState().notifyRender();
}

/** One re-render per frame however fast pointer events arrive. */
const coalescedTextTransform = coalesceToAnimationFrame(applyTextTransformStep);

export function handleTextTransformMove(state: InteractionState, canvasPos: Point, metaKey: boolean): void {
  const gesture = state.gesture;
  if (gesture.kind !== 'textTransform' || !state.startPoint || !state.layerId) return;
  coalescedTextTransform({
    layerId: state.layerId,
    startFrame: gesture.startFrame,
    handle: gesture.handle,
    startPoint: state.startPoint,
    canvasPos,
    metaKey,
  });
}

/** Finish a text handle drag: one history entry, and the ⌘-click selection rebuilt around the result. */
export function handleTextTransformUp(state: InteractionState): void {
  const gesture = state.gesture;
  if (gesture.kind !== 'textTransform' || !state.layerId) return;
  coalescedTextTransform.flush();
  liveDrag = null;
  useUIStore.getState().setActiveTransformHandle(null);

  const editor = useEditorStore.getState();
  const layer = editor.document.layers.find((l) => l.id === state.layerId);
  if (!layer || layer === gesture.before.layer) {
    releaseLayerGpu(gesture.before.gpuHandle);
    return;
  }
  editor.pushHistory('Transform', gesture.before);
  if (gesture.reselectAlpha) selectLayerAlpha(state.layerId);
  editor.notifyRender();
}

/** Drop a drag that never finished (tool switch, cancelled pointer). For tests too. */
export function resetTextTransformDrag(): void {
  coalescedTextTransform.cancel();
  liveDrag = null;
}

/** Text layer whose ⌘-click selection was dropped for a body drag, to rebuild on release. */
let reselectAfterMove: string | null = null;

/**
 * Before a Move-tool body drag on a text layer whose selection takes it in
 * whole, drop the selection so the drag moves the layer — the text stays
 * live — instead of lifting its pixels into a float. The selection is
 * rebuilt around the moved text on release ({@link finishTextBodyMove}).
 */
export function releaseCoveringTextSelection(): void {
  reselectAfterMove = null;
  const editor = useEditorStore.getState();
  if (!editor.selection.active) return;
  const target = getTextTransformTarget();
  if (!target) return;
  editor.clearSelection();
  useUIStore.getState().setTransform(null);
  reselectAfterMove = target.layer.id;
}

export function finishTextBodyMove(): void {
  const layerId = reselectAfterMove;
  reselectAfterMove = null;
  if (layerId) selectLayerAlpha(layerId);
}
