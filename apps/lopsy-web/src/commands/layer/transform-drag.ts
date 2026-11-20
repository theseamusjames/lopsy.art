import { CommandError } from '../command';
import { refusalError } from '../refusal';
import { MAX_COORDINATE, MIN_COORDINATE } from '../context';
import { checkGesturePress, runGesture, runHeldGesture } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { deselectAndCommit } from '../../app/interactions/deselect-and-commit';
import { hitTestTransformHandle } from '../../app/interactions/transform-handlers';
import { getTextTransformTarget } from '../../app/interactions/text-transform-handlers';
import { MASK_EDIT_MOVE_HINT } from '../../app/interactions/mask-edit-move-guard';
import {
  currentLayerTransformTargets,
  getLayerTransformBox,
  isLayerTransformCurrent,
  isLayerTransformLive,
  textInLayerTransformRefusal,
} from '../../app/interactions/layer-transform';
import { readLayerContentRectLocal } from '../../app/layer-content-rect';
import { getEngine } from '../../engine-wasm/engine-state';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import { getTransformedBounds, type TransformHandle, type TransformState } from '../../tools/transform/transform';
import { getHandlePositions, hasRotateHandles } from '../../tools/transform/transform-handles';
import {
  applyMatrix,
  docToLayout,
  frameCentre,
  invertMatrix,
  matrixOf,
  maxScaleOf,
  multiplyMatrix,
  type TextFrame,
  type TextMatrix,
} from '../../tools/text/text-transform';
import { MAX_DOCUMENT_SIDE } from '../../utils/document-size';
import type { Layer, Point } from '../../types';
import {
  ROTATE_HANDLE,
  anchorAxes,
  handleForAnchor,
  pressPoint,
  rotateRelease,
  scaleRelease,
  wrapAngle,
  type DragFrame,
  type Limits,
  type ScaleAnchor,
} from './transform-geometry';

/** A rotate or scale request, in radians and factors. */
export type DragStep =
  | { readonly kind: 'rotate'; readonly angle: number }
  | { readonly kind: 'scale'; readonly factor: Point; readonly anchor: ScaleAnchor };

/** What a drag did: the angle turned (degrees) or the factors stretched by, read back from the editor. */
export interface DragOutcome {
  rotate?: number;
  scale?: Point;
}

/** How far a drag's angle may be from the request: a whole-pixel release resolves it far more finely. */
export const ROTATE_TOLERANCE = (0.01 * Math.PI) / 180;
/** How far (document pixels) a dragged edge may land from where the factor puts it: half a pixel, and the box's own axes may be turned. */
export const SCALE_TOLERANCE_PX = 0.75;

const ANGLE_SNAP = Math.PI / 12;
const LIMITS: Limits = { min: MIN_COORDINATE, max: MAX_COORDINATE };

/** Which box the Move tool shows and how its drag is read back. */
type Kind = 'box' | 'selection' | 'text';

interface Target {
  readonly kind: Kind;
  /** The handle state the press is hit-tested against. */
  readonly state: TransformState;
  readonly frame: DragFrame;
  /** The text frame's linear part (identity for the other boxes). */
  readonly matrix: TextMatrix;
}

const IDENTITY: TextMatrix = { a: 1, b: 0, c: 0, d: 1 };

function topEntry(): unknown {
  const { undoStack } = useEditorStore.getState();
  return undoStack[undoStack.length - 1];
}

function ui() {
  return useUIStore.getState();
}

function isSnapping(): boolean {
  const { showGrid, snapToGrid } = ui();
  return showGrid && snapToGrid;
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The frame of an untransformed box (the layers' content box, or a fresh selection's). */
function boxFrame(state: TransformState): DragFrame {
  const b = getTransformedBounds(state);
  return {
    box: state.originalBounds,
    toLocal: (p) => p,
    toDoc: (p) => p,
    pivot: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
  };
}

function textFrame(frame: TextFrame): DragFrame {
  return {
    box: frame.box,
    toLocal: (p) => docToLayout(frame, p),
    toDoc: (p) => {
      const q = applyMatrix(frame.matrix, p);
      return { x: q.x + frame.anchor.x, y: q.y + frame.anchor.y };
    },
    pivot: frameCentre(frame),
  };
}

function isIdentityBox(state: TransformState): boolean {
  return state.rotation === 0 && state.scaleX === 1 && state.scaleY === 1 && state.translateX === 0
    && state.translateY === 0 && state.skewX === 0 && state.skewY === 0;
}

function requireIdentity(state: TransformState): TransformState {
  if (!isIdentityBox(state)) throw new Error('layer.transform: the Move tool\'s box still holds a pending transform after it was committed.');
  return state;
}

/** Refuses a step the box's Move-options mode turns into something else. */
function checkMode(mode: string, step: DragStep, isText: boolean): void {
  if (step.kind === 'rotate') {
    if (mode === 'distort' || mode === 'perspective') {
      throw new CommandError('refused', `The Move options are in ${mode === 'distort' ? 'Distort' : 'Perspective'} mode, which has no rotate handles: choose Free in the Move options bar.`);
    }
    return;
  }
  if (mode === 'free') return;
  const axes = anchorAxes(step.anchor);
  if (isText && mode === 'skew' && axes.x && axes.y) return;
  const name = mode === 'skew' ? 'Skew' : mode === 'distort' ? 'Distort' : 'Perspective';
  throw new CommandError('refused', `The Move options are in ${name} mode, where this handle ${mode === 'skew' ? 'skews' : 'moves one corner'} instead of scaling: choose Free in the Move options bar.`);
}

function checkMaskMode(): void {
  const { maskMode } = ui();
  if (maskMode === 'quickMask') throw new CommandError('refused', 'Quick Mask is on, and the Move tool shows no transform handles in it: leave it first (quickmask.set with enabled: false).');
  if (maskMode === 'layerMask') throw new CommandError('refused', `${MASK_EDIT_MOVE_HINT} The Move tool shows no transform handles while a layer mask is being edited (mask.edit with enabled: false).`);
}

/** Several layers or a group: the shared box the Move tool frames them with. */
async function boxTarget(measure: () => Promise<void>, step: DragStep): Promise<Target> {
  checkMaskMode();
  const refusal = textInLayerTransformRefusal(false);
  if (refusal) throw refusalError(refusal);
  checkMode(ui().layerTransformMode, step, false);
  // A transform the UI left pending is baked first, as Escape does, so the step applies to what is on screen.
  if (isLayerTransformLive()) deselectAndCommit();
  await measure();
  const box = getLayerTransformBox();
  if (!box) throw new CommandError('refused', 'The selected layers have nothing to transform: they are empty or locked.');
  const state = requireIdentity(box);
  return { kind: 'box', state, frame: boxFrame(state), matrix: IDENTITY };
}

/** One raster layer: its alpha loaded as the selection, as a Cmd-click on its thumbnail does, frames it with handles. */
async function selectionTarget(layer: Layer): Promise<Target> {
  checkMaskMode();
  checkGesturePress('move', layer);
  await selectLayerAlpha(layer.id);
  const state = ui().transform;
  if (!useEditorStore.getState().selection.active || !state) {
    throw new CommandError('refused', `"${layer.name}" has no pixels on the canvas to transform.`);
  }
  return { kind: 'selection', state: requireIdentity(state), frame: boxFrame(state), matrix: IDENTITY };
}

/** One live text layer: its own handles, around its layout box. */
function textTarget(layer: Layer, step: DragStep): Target {
  if (layer.type !== 'text') throw new Error('textTarget needs a text layer');
  if (layer.pathId) {
    throw new CommandError('refused', `"${layer.name}" is text on a path, which has no transform handles: rasterize it (layer.rasterize) to turn or scale it.`);
  }
  checkGesturePress('move', layer);
  if (!layer.visible) throw new CommandError('refused', `"${layer.name}" is hidden, and the Move tool shows no handles for a hidden text layer: show it first (layer.set with visible: true).`);
  if (ui().maskMode === 'quickMask') checkMaskMode();
  const target = getTextTransformTarget();
  if (!target || target.layer.id !== layer.id) throw new CommandError('refused', `The Move tool shows no handles for the text layer "${layer.name}" now.`);
  checkMode(ui().textTransformMode, step, true);
  return { kind: 'text', state: target.state, frame: textFrame(target.frame), matrix: target.frame.matrix };
}

function hitTest(target: Target): (p: Point) => TransformHandle | null {
  const zoom = useEditorStore.getState().viewport.zoom;
  return (p) => hitTestTransformHandle(p, target.state, zoom);
}

/** The press on `handle`, confirmed with the press's own hit test: a press beside it would drag the layers instead. */
function press(target: Target, handle: TransformHandle): Point {
  const at = getHandlePositions(target.state)[handle];
  const point = pressPoint(at, handle, hitTest(target));
  if (!point) {
    throw new CommandError('refused', `No whole-pixel press lands on the box's ${handle} handle at this zoom, and a press beside it would drag the layers instead: change the zoom (ui.view.fit) and try again.`);
  }
  return point;
}

interface Drag {
  readonly points: readonly [Point, Point];
  /** What the drag reaches before any snapping, for the snapping check. */
  readonly expected: DragOutcome;
}

/** The angle, from the box's current one, that the rotate handler's 15° snap would land on. */
function snappedTurn(target: Target, reached: number): number {
  const base = target.kind === 'text' ? Math.atan2(target.matrix.b, target.matrix.a) : target.state.rotation;
  return Math.round((base + reached) / ANGLE_SNAP) * ANGLE_SNAP - base;
}

function rotateDrag(target: Target, angle: number): Drag {
  if (!hasRotateHandles(target.state)) throw new CommandError('refused', 'The box has no rotate handles in this mode: choose Free in the Move options bar.');
  const from = press(target, ROTATE_HANDLE);
  const release = rotateRelease(target.frame.pivot, from, angle, LIMITS);
  if (!release) throw new CommandError('refused', 'No release point for this turn lies inside the coordinate range.');
  if (isSnapping()) {
    const snapped = snappedTurn(target, release.reached);
    if (Math.abs(wrapAngle(snapped - angle)) > ROTATE_TOLERANCE) {
      throw new CommandError(
        'refused',
        `View > Snap to Grid is on with the grid shown, so a rotate drag lands on 15° steps: it would turn ${round(degrees(wrapAngle(snapped)))}° instead of ${round(degrees(angle))}°. Turn Snap to Grid off in the View menu, or turn by a multiple of 15°.`,
      );
    }
  }
  return { points: [from, release.point], expected: { rotate: release.reached } };
}

function checkScaleSize(target: Target, factor: Point): void {
  const { box } = target.frame;
  const width = box.width * Math.hypot(target.matrix.a, target.matrix.b) * factor.x;
  const height = box.height * Math.hypot(target.matrix.c, target.matrix.d) * factor.y;
  if (Math.max(width, height) > MAX_DOCUMENT_SIDE) {
    throw new CommandError('refused', `The scaled box would be ${Math.round(width)} × ${Math.round(height)} px, larger than the largest document side (${MAX_DOCUMENT_SIDE} px).`);
  }
  if (target.kind === 'text') {
    const next = multiplyMatrix(target.matrix, { a: factor.x, b: 0, c: 0, d: factor.y });
    if (maxScaleOf(next) > 64) throw new CommandError('refused', 'A text layer can be stretched to at most 64 times its type size: rasterize it (layer.rasterize) to scale it further.');
  }
}

function scaleDrag(target: Target, factor: Point, anchor: ScaleAnchor): Drag {
  checkScaleSize(target, factor);
  const handle = handleForAnchor(anchor);
  const from = press(target, handle);
  const release = scaleRelease(target.frame, handle, from, factor, LIMITS);
  if (!release) throw new CommandError('refused', 'The release point this scale needs lies outside the coordinate range: scale in smaller steps.');
  if (target.kind !== 'text' && isSnapping()) {
    const { gridSize } = ui();
    const p = release.point;
    const snapped = { x: Math.round(p.x / gridSize) * gridSize, y: Math.round(p.y / gridSize) * gridSize };
    if (snapped.x !== p.x || snapped.y !== p.y) {
      throw new CommandError(
        'refused',
        `View > Snap to Grid is on with the grid shown, so a scale drag snaps its handle to the ${gridSize} px grid and would not give the factors asked for. Turn Snap to Grid off in the View menu.`,
      );
    }
  }
  return { points: [from, release.point], expected: { scale: release.reached } };
}

function textMatrixNow(layerId: string): TextMatrix | null {
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === layerId);
  return layer?.type === 'text' ? matrixOf(layer.transform) : null;
}

/** The turn or stretch the drag left, read back from the editor's own state. */
function readBack(target: Target, step: DragStep, textLayerId: string | null): DragOutcome | null {
  if (target.kind === 'text') {
    const after = textLayerId ? textMatrixNow(textLayerId) : null;
    const inverse = invertMatrix(target.matrix);
    if (!after || !inverse) return null;
    if (step.kind === 'rotate') {
      const turn = multiplyMatrix(after, inverse);
      return { rotate: Math.atan2(turn.b, turn.a) };
    }
    const stretch = multiplyMatrix(inverse, after);
    return { scale: { x: stretch.a, y: stretch.d } };
  }
  const state = target.kind === 'box' ? ui().layerTransform : ui().transform;
  if (!state) return null;
  return step.kind === 'rotate' ? { rotate: state.rotation } : { scale: { x: state.scaleX, y: state.scaleY } };
}

function checkReached(target: Target, step: DragStep, outcome: DragOutcome | null): DragOutcome {
  if (step.kind === 'rotate') {
    const turned = outcome?.rotate;
    if (turned === undefined || Math.abs(wrapAngle(turned - step.angle)) > ROTATE_TOLERANCE) {
      throw new Error(`layer.transform: the rotate drag turned ${turned === undefined ? 'nothing' : `${degrees(turned)}°`}, not ${degrees(step.angle)}°.`);
    }
    return { rotate: round(degrees(step.angle + wrapAngle(turned - step.angle))) };
  }
  const reached = outcome?.scale;
  const { box } = target.frame;
  const spanX = box.width * Math.hypot(target.matrix.a, target.matrix.b);
  const spanY = box.height * Math.hypot(target.matrix.c, target.matrix.d);
  const isClose = reached
    && Math.abs(reached.x - step.factor.x) * spanX <= SCALE_TOLERANCE_PX
    && Math.abs(reached.y - step.factor.y) * spanY <= SCALE_TOLERANCE_PX;
  if (!reached || !isClose) {
    throw new Error(`layer.transform: the scale drag stretched by ${reached ? `${reached.x} × ${reached.y}` : 'nothing'}, not ${step.factor.x} × ${step.factor.y}.`);
  }
  return { scale: { x: round(reached.x), y: round(reached.y) } };
}

/**
 * Performs `step` as a handle drag of the box the Move tool shows for the
 * selected layers, through the canvas gesture dispatcher, then ends it as
 * Escape does so nothing is left pending. `isBox` is whether the Move tool
 * frames the selection in one shared box (several layers, a group);
 * otherwise `layer` is the one active layer. `measure` waits for the
 * shared box's bounds.
 */
export async function dragTransform(
  step: DragStep,
  isBox: boolean,
  layer: Layer,
  measure: () => Promise<void>,
): Promise<{ layers: string[]; outcome: DragOutcome }> {
  const target = isBox
    ? await boxTarget(measure, step)
    : layer.type === 'text'
      ? textTarget(layer, step)
      : layer.type === 'raster'
        ? await selectionTarget(layer)
        : refuseSingle(layer);
  const ids = target.kind === 'box' ? currentLayerTransformTargets() : [layer.id];
  try {
    const drag = step.kind === 'rotate' ? rotateDrag(target, step.angle) : scaleDrag(target, step.factor, step.anchor);
    const before = topEntry();
    const input = { tool: 'move', points: drag.points } as const;
    if (target.kind === 'box') await runHeldGesture(input, sessionBegun);
    else runGesture(input);
    if (topEntry() === before) {
      throw new CommandError('refused', 'The handle press was not taken as a transform: nothing changed.');
    }
    const outcome = checkReached(target, step, readBack(target, step, target.kind === 'text' ? layer.id : null));
    return { layers: ids, outcome };
  } finally {
    if (target.kind !== 'text') deselectAndCommit();
  }
}

/**
 * Holds the press until the shared box's session has begun. The press's own
 * history push re-reads the active layer's content bounds, so the session
 * usually begins only once that read is in, and moves before it are not
 * rendered (layer-transform.ts, beginLayerTransformSessionWhenMeasured).
 */
async function sessionBegun(): Promise<void> {
  const engine = getEngine();
  if (!engine || isLayerTransformCurrent()) return;
  await Promise.all(currentLayerTransformTargets().map((id) => readLayerContentRectLocal(engine, id)));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (!isLayerTransformCurrent()) throw new Error('layer.transform: the transform session did not begin after the handle press.');
}

function refuseSingle(layer: Layer): never {
  throw new CommandError('refused', `"${layer.name}" is a ${layer.type} layer, which the Move tool's handles do not transform on its own.`);
}
