import { CommandError } from '../command';
import { refusalError } from '../refusal';
import { MAX_COORDINATE, MIN_COORDINATE } from '../context';
import { checkGesturePress, runGesture, runHeldGesture } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore, type TextTransformMode } from '../../app/ui-store';
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
import { setTransformModeFromMoveOptions } from '../../app/interactions/move-transform-buttons';
import { readLayerContentRectLocal } from '../../app/layer-content-rect';
import { getEngine } from '../../engine-wasm/engine-state';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import {
  computeDistort,
  computePerspective,
  getCornerPositions,
  getTransformedBounds,
  type CornerOffsets,
  type TransformHandle,
  type TransformMode,
  type TransformState,
} from '../../tools/transform/transform';
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
  handleForAnchor,
  isConvexQuad,
  pressPoint,
  rotateRelease,
  scaleRelease,
  skewAxis,
  skewRelease,
  wrapAngle,
  type Corner,
  type DragFrame,
  type Limits,
  type ScaleAnchor,
  type SkewAnchor,
} from './transform-geometry';

/** One corner handle dragged by a whole-pixel offset, in Distort or Perspective mode. */
export interface CornerDrag {
  readonly handle: Corner;
  readonly offset: Point;
}

/**
 * A handle-drag request: a turn in radians, scale factors, a shear as the
 * tangent of its angle, or corner handles dragged one after another.
 */
export type DragStep =
  | { readonly kind: 'rotate'; readonly angle: number }
  | { readonly kind: 'scale'; readonly factor: Point; readonly anchor: ScaleAnchor }
  | { readonly kind: 'skew'; readonly tan: number; readonly anchor: SkewAnchor }
  | { readonly kind: 'corners'; readonly mode: 'distort' | 'perspective'; readonly drags: readonly CornerDrag[] };

/**
 * What the drags did, read back from the editor: the angle turned (degrees),
 * the factors stretched by, the shear (degrees, along x or y), or how far
 * each corner of the box moved.
 */
export interface DragOutcome {
  rotate?: number;
  scale?: Point;
  skew?: Point;
  corners?: Record<Corner, Point>;
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

/** Steps that put things back when the command ends, run last-added first. */
type Undo = Array<() => void>;

/** The Move-options mode whose handles make `step`. */
function modeFor(step: DragStep): TransformMode {
  if (step.kind === 'skew') return 'skew';
  return step.kind === 'corners' ? step.mode : 'free';
}

/** Presses the shared box's mode button for `mode`, and the one it found pressed when the command ends. */
function pressBoxMode(mode: TransformMode, undo: Undo): void {
  const previous = ui().layerTransformMode;
  if (previous === mode) return;
  setTransformModeFromMoveOptions(mode, true);
  undo.push(() => setTransformModeFromMoveOptions(previous, true));
}

/** Presses a text layer's Free or Skew button, and the one it found pressed when the command ends. */
function pressTextMode(mode: TextTransformMode, undo: Undo): void {
  const previous = ui().textTransformMode;
  if (previous === mode) return;
  ui().setTextTransformMode(mode);
  undo.push(() => ui().setTextTransformMode(previous));
}

function checkMaskMode(): void {
  const { maskMode } = ui();
  if (maskMode === 'quickMask') throw new CommandError('refused', 'Quick Mask is on, and the Move tool shows no transform handles in it: leave it first (quickmask.set with enabled: false).');
  if (maskMode === 'layerMask') throw new CommandError('refused', `${MASK_EDIT_MOVE_HINT} The Move tool shows no transform handles while a layer mask is being edited (mask.edit with enabled: false).`);
}

/** Several layers or a group: the shared box the Move tool frames them with. */
async function boxTarget(measure: () => Promise<void>, step: DragStep, undo: Undo): Promise<Target> {
  checkMaskMode();
  const refusal = textInLayerTransformRefusal(step.kind === 'corners');
  if (refusal) throw refusalError(refusal);
  // A transform the UI left pending is baked first, as Escape does, so the step applies to what is on screen.
  if (isLayerTransformLive()) deselectAndCommit();
  pressBoxMode(modeFor(step), undo);
  await measure();
  const box = getLayerTransformBox();
  if (!box) throw new CommandError('refused', 'The selected layers have nothing to transform: they are empty or locked.');
  undo.push(deselectAndCommit);
  const state = requireIdentity(box);
  return { kind: 'box', state, frame: boxFrame(state), matrix: IDENTITY };
}

/** One raster layer: its alpha loaded as the selection, as a Cmd-click on its thumbnail does, frames it with handles. */
async function selectionTarget(layer: Layer, step: DragStep, undo: Undo): Promise<Target> {
  checkMaskMode();
  checkGesturePress('move', layer);
  await selectLayerAlpha(layer.id);
  if (!useEditorStore.getState().selection.active || !ui().transform) {
    throw new CommandError('refused', `"${layer.name}" has no pixels on the canvas to transform.`);
  }
  undo.push(deselectAndCommit);
  // The selection's box is new and in Free mode; its mode goes with it when the selection is dropped.
  const mode = modeFor(step);
  if (mode !== 'free') setTransformModeFromMoveOptions(mode, false);
  const state = ui().transform;
  if (!state || state.mode !== mode) throw new Error(`layer.transform: the selection's box did not take the ${mode} mode.`);
  return { kind: 'selection', state: requireIdentity(state), frame: boxFrame(state), matrix: IDENTITY };
}

/** One live text layer: its own handles, around its layout box. */
function textTarget(layer: Layer, step: DragStep, undo: Undo): Target {
  if (layer.type !== 'text') throw new Error('textTarget needs a text layer');
  if (step.kind === 'corners') {
    throw new CommandError('refused', `The Move tool offers a text layer only its Free and Skew modes: rasterize "${layer.name}" (layer.rasterize) to ${step.mode === 'distort' ? 'distort it' : 'give it perspective'}.`);
  }
  if (layer.pathId) {
    throw new CommandError('refused', `"${layer.name}" is text on a path, which has no transform handles: rasterize it (layer.rasterize) to turn, scale or skew it.`);
  }
  checkGesturePress('move', layer);
  if (!layer.visible) throw new CommandError('refused', `"${layer.name}" is hidden, and the Move tool shows no handles for a hidden text layer: show it first (layer.set with visible: true).`);
  if (ui().maskMode === 'quickMask') checkMaskMode();
  pressTextMode(step.kind === 'skew' ? 'skew' : 'free', undo);
  const target = getTextTransformTarget();
  if (!target || target.layer.id !== layer.id) throw new CommandError('refused', `The Move tool shows no handles for the text layer "${layer.name}" now.`);
  return { kind: 'text', state: target.state, frame: textFrame(target.frame), matrix: target.frame.matrix };
}

/** The press on `handle` of the box in `state`, confirmed with the press's own hit test: a press beside it would drag the layers instead. */
function press(state: TransformState, handle: TransformHandle): Point {
  const zoom = useEditorStore.getState().viewport.zoom;
  const at = getHandlePositions(state)[handle];
  const point = pressPoint(at, handle, (p) => hitTestTransformHandle(p, state, zoom));
  if (!point) {
    throw new CommandError('refused', `No whole-pixel press lands on the box's ${handle} handle at this zoom, and a press beside it would drag the layers instead: change the zoom (ui.view.fit) and try again.`);
  }
  return point;
}

interface Drag {
  readonly points: readonly [Point, Point];
}

/** The angle, from the box's current one, that the rotate handler's 15° snap would land on. */
function snappedTurn(target: Target, reached: number): number {
  const base = target.kind === 'text' ? Math.atan2(target.matrix.b, target.matrix.a) : target.state.rotation;
  return Math.round((base + reached) / ANGLE_SNAP) * ANGLE_SNAP - base;
}

function rotateDrag(target: Target, angle: number): Drag {
  if (!hasRotateHandles(target.state)) throw new CommandError('refused', 'The box has no rotate handles in this mode: choose Free in the Move options bar.');
  const from = press(target.state, ROTATE_HANDLE);
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
  return { points: [from, release.point] };
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
  const from = press(target.state, handle);
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
  return { points: [from, release.point] };
}

/** The distance (document pixels) a shear of tangent 1 slides the dragged edge. */
function skewTravel(target: Target, anchor: SkewAnchor): number {
  const { box } = target.frame;
  return skewAxis(anchor) === 'x'
    ? box.height * Math.hypot(target.matrix.a, target.matrix.b)
    : box.width * Math.hypot(target.matrix.c, target.matrix.d);
}

function skewDrag(target: Target, tan: number, anchor: SkewAnchor): Drag {
  const handle = handleForAnchor(anchor);
  const from = press(target.state, handle);
  const release = skewRelease(target.frame, handle, from, tan, LIMITS);
  if (!release) throw new CommandError('refused', 'The release point this skew needs lies outside the coordinate range.');
  if (release.reached === 0) {
    throw new CommandError('refused', `This skew would slide the box's ${handle} edge by less than a pixel (the edge is ${round(skewTravel(target, anchor))} px from the one held), and a drag moves by whole pixels: skew by a larger angle.`);
  }
  return { points: [from, release.point] };
}

interface CornerPlan extends Drag {
  /** The box's corner offsets once this drag is made. */
  readonly corners: CornerOffsets;
}

function sameCorners(a: CornerOffsets, b: CornerOffsets): boolean {
  return a.every((corner, i) => corner.x === b[i]?.x && corner.y === b[i]?.y);
}

function withinLimits(p: Point): boolean {
  return p.x >= LIMITS.min && p.x <= LIMITS.max && p.y >= LIMITS.min && p.y <= LIMITS.max;
}

/**
 * Where each corner drag presses and releases, worked out before the first
 * press with the handlers' own corner maths: every drag after the first
 * presses a handle the drags before it moved, and a later one that could not
 * be made would leave the earlier ones applied.
 */
function planCorners(target: Target, mode: 'distort' | 'perspective', drags: readonly CornerDrag[]): CornerPlan[] {
  const compute = mode === 'distort' ? computeDistort : computePerspective;
  let state = target.state;
  const plan: CornerPlan[] = [];
  for (const { handle, offset } of drags) {
    const from = press(state, handle);
    const to = { x: from.x + offset.x, y: from.y + offset.y };
    if (!withinLimits(to)) throw new CommandError('refused', `The release point for the ${handle} corner lies outside the coordinate range: move it less.`);
    const { corners } = compute(handle, from, to, state);
    state = { ...state, corners };
    plan.push({ points: [from, to], corners });
  }
  checkQuad(getCornerPositions(state));
  return plan;
}

function checkQuad(quad: readonly Point[]): void {
  if (!isConvexQuad(quad)) {
    const at = quad.map((p) => `(${p.x}, ${p.y})`).join(', ');
    throw new CommandError('refused', `These offsets would fold the box: its corners would be at ${at} (clockwise from the top-left), which is not a convex quad. Move the corners less.`);
  }
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (Math.max(width, height) > MAX_DOCUMENT_SIDE) {
    throw new CommandError('refused', `The box would be ${width} × ${height} px, larger than the largest document side (${MAX_DOCUMENT_SIDE} px).`);
  }
}

function textMatrixNow(layerId: string): TextMatrix | null {
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === layerId);
  return layer?.type === 'text' ? matrixOf(layer.transform) : null;
}

/** The box's pending transform as the editor holds it now. */
function pendingState(kind: Kind): TransformState | null {
  return kind === 'box' ? ui().layerTransform : ui().transform;
}

/** A text layer's own stretch or shear since the drag began: its matrix now, with the one it had divided out. */
function textChange(target: Target, layerId: string | null): { turn: TextMatrix; stretch: TextMatrix } | null {
  const after = layerId ? textMatrixNow(layerId) : null;
  const inverse = invertMatrix(target.matrix);
  if (!after || !inverse) return null;
  return { turn: multiplyMatrix(after, inverse), stretch: multiplyMatrix(inverse, after) };
}

/** What the drag left, read back from the editor's own state: radians, factors, or the shear's tangent on its axis. */
function readBack(target: Target, step: DragStep, textLayerId: string | null): DragOutcome | null {
  if (step.kind === 'corners') return null;
  if (target.kind === 'text') {
    const change = textChange(target, textLayerId);
    if (!change) return null;
    if (step.kind === 'rotate') return { rotate: Math.atan2(change.turn.b, change.turn.a) };
    if (step.kind === 'scale') return { scale: { x: change.stretch.a, y: change.stretch.d } };
    return { skew: { x: change.stretch.c, y: change.stretch.b } };
  }
  const state = pendingState(target.kind);
  if (!state) return null;
  if (step.kind === 'rotate') return { rotate: state.rotation };
  if (step.kind === 'scale') return { scale: { x: state.scaleX, y: state.scaleY } };
  return { skew: { x: Math.tan(state.skewX), y: Math.tan(state.skewY) } };
}

function checkSkewReached(target: Target, step: Extract<DragStep, { kind: 'skew' }>, outcome: DragOutcome | null): DragOutcome {
  const axis = skewAxis(step.anchor);
  const reached = outcome?.skew?.[axis];
  const travel = skewTravel(target, step.anchor);
  if (reached === undefined || Math.abs(reached - step.tan) * travel > SCALE_TOLERANCE_PX) {
    throw new Error(`layer.transform: the skew drag sheared by ${reached === undefined ? 'nothing' : `${degrees(Math.atan(reached))}°`}, not ${degrees(Math.atan(step.tan))}°.`);
  }
  const angle = round(degrees(Math.atan(reached)));
  return { skew: axis === 'x' ? { x: angle, y: 0 } : { x: 0, y: angle } };
}

function checkReached(target: Target, step: Exclude<DragStep, { kind: 'corners' }>, outcome: DragOutcome | null): DragOutcome {
  if (step.kind === 'skew') return checkSkewReached(target, step, outcome);
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

/** One handle drag through the canvas gesture dispatcher, refused when the press was not taken as a transform. */
async function drag(kind: Kind, points: readonly [Point, Point]): Promise<void> {
  const before = topEntry();
  const input = { tool: 'move', points } as const;
  if (kind === 'box') await runHeldGesture(input, sessionBegun);
  else runGesture(input);
  if (topEntry() === before) {
    throw new CommandError('refused', 'The handle press was not taken as a transform: nothing changed.');
  }
}

/** The corner drags, one after another on the same pending transform, each checked against the plan. */
async function dragCorners(target: Target, step: Extract<DragStep, { kind: 'corners' }>): Promise<DragOutcome> {
  let corners = target.state.corners;
  const plan = planCorners(target, step.mode, step.drags);
  for (const [index, planned] of plan.entries()) {
    await drag(target.kind, planned.points).catch((error: unknown) => {
      // Every press was checked against the plan, so a later one not taken is a bug, and the drags before it stay made.
      if (index === 0 || !(error instanceof CommandError)) throw error;
      throw new Error(`layer.transform: ${step.mode} drag ${index + 1} of ${plan.length} was not made (${error.message}) after ${index} before it were: history.undo with steps: ${index} takes those back.`);
    });
    const now = pendingState(target.kind)?.corners;
    if (!now || !sameCorners(now, planned.corners)) {
      throw new Error(`layer.transform: a ${step.mode} drag left the corners at ${JSON.stringify(now ?? null)}, not ${JSON.stringify(planned.corners)}.`);
    }
    corners = now;
  }
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  return { corners: { 'top-left': { ...topLeft }, 'top-right': { ...topRight }, 'bottom-right': { ...bottomRight }, 'bottom-left': { ...bottomLeft } } };
}

async function dragOnce(target: Target, step: Exclude<DragStep, { kind: 'corners' }>, textLayerId: string | null): Promise<DragOutcome> {
  const planned = step.kind === 'rotate'
    ? rotateDrag(target, step.angle)
    : step.kind === 'scale'
      ? scaleDrag(target, step.factor, step.anchor)
      : skewDrag(target, step.tan, step.anchor);
  await drag(target.kind, planned.points);
  return checkReached(target, step, readBack(target, step, textLayerId));
}

/**
 * Performs `step` as handle drags of the box the Move tool shows for the
 * selected layers, through the canvas gesture dispatcher, in the Move-options
 * mode whose handles make it, then ends it as Escape does so nothing is left
 * pending and puts the mode back. `isBox` is whether the Move tool frames
 * the selection in one shared box (several layers, a group); otherwise
 * `layer` is the one active layer. `measure` waits for the shared box's
 * bounds.
 */
export async function dragTransform(
  step: DragStep,
  isBox: boolean,
  layer: Layer,
  measure: () => Promise<void>,
): Promise<{ layers: string[]; outcome: DragOutcome }> {
  const undo: Undo = [];
  try {
    const target = isBox
      ? await boxTarget(measure, step, undo)
      : layer.type === 'text'
        ? textTarget(layer, step, undo)
        : layer.type === 'raster'
          ? await selectionTarget(layer, step, undo)
          : refuseSingle(layer);
    const ids = target.kind === 'box' ? currentLayerTransformTargets() : [layer.id];
    const outcome = step.kind === 'corners'
      ? await dragCorners(target, step)
      : await dragOnce(target, step, target.kind === 'text' ? layer.id : null);
    return { layers: ids, outcome };
  } finally {
    for (const put of undo.reverse()) put();
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
