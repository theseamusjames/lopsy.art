import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { MAX_SPAN, afterActivation, layerRefSpec, offsetSpec, requireDocument, requireEngine, resolveLayer, selectReplace } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import {
  currentLayerTransformTargets,
  getLayerTransformBox,
  textInLayerTransformRefusal,
} from '../../app/interactions/layer-transform';
import {
  flipFromMoveOptions,
  rotateFromMoveOptions,
  wantsLayerTransform,
} from '../../app/interactions/move-transform-buttons';
import { readLayerContentRectLocal } from '../../app/layer-content-rect';
import { transformableTextLayer } from '../../app/text-layer-transform';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import type { Layer, Point } from '../../types';
import { dragTransform, type CornerDrag, type DragOutcome, type DragStep } from './transform-drag';
import {
  CORNERS,
  SCALE_ANCHORS,
  SKEW_ANCHORS,
  anchorAxes,
  skewAxis,
  type Corner,
  type ScaleAnchor,
  type SkewAnchor,
} from './transform-geometry';

export interface LayerTransformResult extends DragOutcome {
  /** The layers the step transformed. */
  layers: string[];
}

type Axis = 'horizontal' | 'vertical';
type Turn = 'cw' | 'ccw';

interface Step {
  rotate?: Turn;
  flip?: Axis;
}

const TEXT_ROTATE_REFUSAL = 'Rasterize this text layer to rotate it.';

function store() {
  return useEditorStore.getState();
}

function topEntry(): unknown {
  const { undoStack } = store();
  return undoStack[undoStack.length - 1];
}

const ROTATE_RANGE = 360;
const SCALE_MIN = 0.05;
const SCALE_MAX = 20;
/** The largest shear the Skew handles give (tools/transform/transform-skew.ts). */
const SKEW_RANGE = 60;

type Anchor = ScaleAnchor;
type CornerOffsetsParam = Partial<Record<Corner, Point>>;

interface EdgePull {
  inset: number;
  shift: number;
}

interface PerspectiveParam {
  top?: EdgePull;
  bottom?: EdgePull;
}

/** What a call asks for: exactly one of these is given. */
interface Asked {
  rotate?: number;
  flip?: Axis;
  scale?: Point;
  skew?: Point;
  distort?: CornerOffsetsParam;
  perspective?: PerspectiveParam;
  anchor?: Anchor;
}

interface Request {
  /** A Move-options button step: a quarter turn or a flip. */
  button?: Step;
  /** Handle drags: any other turn, a scale, a skew, or corners moved. */
  drag?: DragStep;
}

function parseScale(scale: Point, anchor: ScaleAnchor): DragStep {
  if (scale.x === 1 && scale.y === 1) throw new CommandError('invalid', 'layer.transform: scale {x: 1, y: 1} changes nothing.');
  const axes = anchorAxes(anchor);
  if ((!axes.x && scale.x !== 1) || (!axes.y && scale.y !== 1)) {
    throw new CommandError(
      'invalid',
      `layer.transform: the anchor "${anchor}" is an edge, whose drag scales only ${axes.x ? 'x' : 'y'}: pass ${axes.x ? 'y' : 'x'}: 1, or a corner anchor to scale both.`,
    );
  }
  return { kind: 'scale', factor: { x: scale.x, y: scale.y }, anchor };
}

function isSkewAnchor(anchor: Anchor): anchor is SkewAnchor {
  return (SKEW_ANCHORS as readonly string[]).includes(anchor);
}

function parseSkew(skew: Point, anchor: Anchor | undefined): DragStep {
  if ((skew.x === 0) === (skew.y === 0)) {
    throw new CommandError('invalid', 'layer.transform: skew shears along one axis at a time: pass one of x and y as 0 and the other not (two calls shear along both).');
  }
  const axis = skew.x !== 0 ? 'x' : 'y';
  const held = anchor ?? (axis === 'x' ? 'top' : 'left');
  if (!isSkewAnchor(held) || skewAxis(held) !== axis) {
    throw new CommandError(
      'invalid',
      `layer.transform: a skew along ${axis} holds ${axis === 'x' ? 'the "top" or "bottom"' : 'the "left" or "right"'} edge still, not "${held}".`,
    );
  }
  return { kind: 'skew', tan: Math.tan((skew[axis] * Math.PI) / 180), anchor: held };
}

/** A pointer moves by whole pixels, so an offset is rounded to them; one that rounds to nothing is not a drag. */
function wholeOffset(x: number, y: number): Point | null {
  const offset = { x: Math.round(x), y: Math.round(y) };
  return offset.x === 0 && offset.y === 0 ? null : offset;
}

function parseDistort(distort: CornerOffsetsParam): DragStep {
  const drags: CornerDrag[] = [];
  for (const handle of CORNERS) {
    const given = distort[handle];
    const offset = given ? wholeOffset(given.x, given.y) : null;
    if (offset) drags.push({ handle, offset });
  }
  if (drags.length === 0) throw new CommandError('invalid', 'layer.transform: distort moves no corner by a whole pixel.');
  return { kind: 'corners', mode: 'distort', drags };
}

/** In Perspective mode a corner drag moves the other corner of its top or bottom edge the opposite way, so the left corner's drag sets the edge. */
function parsePerspective(perspective: PerspectiveParam): DragStep {
  const drags: CornerDrag[] = [];
  const edges = [['top', 'top-left'], ['bottom', 'bottom-left']] as const;
  for (const [edge, handle] of edges) {
    const pull = perspective[edge];
    const offset = pull ? wholeOffset(pull.inset, pull.shift) : null;
    if (offset) drags.push({ handle, offset });
  }
  if (drags.length === 0) throw new CommandError('invalid', 'layer.transform: perspective moves neither edge by a whole pixel.');
  return { kind: 'corners', mode: 'perspective', drags };
}

function parseRequest({ rotate, flip, scale, skew, distort, perspective, anchor }: Asked): Request {
  const given = [rotate, flip, scale, skew, distort, perspective].filter((v) => v !== undefined).length;
  if (given !== 1) throw new CommandError('invalid', 'layer.transform: pass exactly one of rotate, flip, scale, skew, distort or perspective.');
  if (anchor !== undefined && scale === undefined && skew === undefined) throw new CommandError('invalid', 'layer.transform: anchor goes with scale or skew only.');
  if (flip) return { button: { flip } };
  if (scale) return { drag: parseScale(scale, anchor ?? 'top-left') };
  if (skew) return { drag: parseSkew(skew, anchor) };
  if (distort) return { drag: parseDistort(distort) };
  if (perspective) return { drag: parsePerspective(perspective) };
  if (rotate === 90) return { button: { rotate: 'cw' } };
  if (rotate === -90) return { button: { rotate: 'ccw' } };
  const turn = rotate ?? 0;
  if (turn % 360 === 0) throw new CommandError('invalid', `layer.transform: rotate ${turn} turns nothing.`);
  return { drag: { kind: 'rotate', angle: (turn * Math.PI) / 180 } };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Selects `layers` as the Layers panel would: a plain click on the first, then Cmd-clicks on the rest. */
function selectLayers(layers: readonly Layer[]): void {
  const [first, ...rest] = layers;
  if (!first) return;
  const doc = store().document;
  const ids = layers.map((layer) => layer.id);
  if (doc.activeLayerId === first.id && sameIds(doc.selectedLayerIds ?? [], ids)) return;
  selectReplace(first.id);
  for (const layer of rest) store().toggleLayerSelection(layer.id);
}

function targets(ref: string | undefined, refs: string[] | undefined): Layer[] {
  if (ref !== undefined && refs !== undefined) throw new CommandError('invalid', 'layer.transform: pass layer or layers, not both.');
  if (refs) {
    const layers = refs.map((r) => resolveLayer(r));
    if (new Set(layers.map((l) => l.id)).size !== layers.length) throw new CommandError('invalid', 'layer.transform: layers names a layer twice.');
    return layers;
  }
  if (ref !== undefined) return [resolveLayer(ref)];
  return [];
}

function wantsBox(): boolean {
  const { selection, document: doc } = store();
  return wantsLayerTransform(selection.active, doc.layers, doc.selectedLayerIds ?? []);
}

/**
 * Waits until every target's content bounds are read, as they are by the
 * time the box a button press acts on is on screen: a box drawn from some
 * of them would turn about the wrong centre.
 */
async function measuredBox(engine: Engine): Promise<void> {
  await Promise.all(currentLayerTransformTargets().map((id) => readLayerContentRectLocal(engine, id)));
  if (!getLayerTransformBox()) throw new CommandError('refused', 'The selected layers have nothing to transform: they are empty or locked.');
}

async function boxStep(engine: Engine, step: Step): Promise<string[]> {
  const refusal = textInLayerTransformRefusal(false);
  if (refusal) throw refusalError(refusal);
  await measuredBox(engine);
  const ids = currentLayerTransformTargets();
  await (step.rotate ? rotateFromMoveOptions(step.rotate) : flipFromMoveOptions(step.flip ?? 'horizontal', true));
  return ids;
}

function checkSingle(layer: Layer, step: Step): void {
  if (layer.type === 'text' && !transformableTextLayer(layer.id)) {
    throw refusalError({ reason: step.rotate ? TEXT_ROTATE_REFUSAL : 'Text on a path has no flip buttons: rasterize it to flip it.', notice: step.rotate ? 'info' : null });
  }
  if (step.flip && layer.type !== 'text') {
    throw new CommandError(
      'refused',
      `The Move tool shows its flip buttons for a selection, several layers, a group or a text layer, not for the single layer "${layer.name}": image.flip-layer flips it (Image > Flip).`,
    );
  }
}

async function singleStep(step: Step): Promise<string[]> {
  const doc = store().document;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!layer) throw new CommandError('refused', 'There is no active layer.');
  checkSingle(layer, step);
  await (step.rotate ? rotateFromMoveOptions(step.rotate) : flipFromMoveOptions(step.flip ?? 'horizontal', false));
  return [layer.id];
}

const MARQUEE_REFUSAL =
  'A marquee is active, and the Move buttons would transform the selected pixels instead of the layers: deselect first (select.none with commit: true), or transform the selection with tool.gesture and the move tool.';

async function buttonStep(engine: Engine, step: Step): Promise<string[]> {
  const before = topEntry();
  const ids = wantsBox() ? await boxStep(engine, step) : await singleStep(step);
  if (topEntry() === before) throw new CommandError('refused', 'Nothing was transformed: the layers have no content to turn or flip.');
  return ids;
}

async function dragStep(engine: Engine, step: DragStep): Promise<LayerTransformResult> {
  const doc = store().document;
  const active = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!active) throw new CommandError('refused', 'There is no active layer.');
  const { layers, outcome } = await dragTransform(step, wantsBox(), active, () => measuredBox(engine));
  return { layers, ...outcome };
}

const cornerOffsetSpec = (corner: string) =>
  ({
    type: 'point',
    min: -MAX_SPAN,
    max: MAX_SPAN,
    optional: true,
    description: `How far the ${corner} corner moves, in document pixels: x to the right (negative: left), y down (negative: up). Rounded to whole pixels.`,
  }) as const;

const edgePullSpec = (edge: string) =>
  ({
    type: 'object',
    optional: true,
    description: `The ${edge} edge: both of its ends move toward its middle by \`inset\`, and the edge moves down by \`shift\`.`,
    fields: {
      inset: offsetSpec(`How far each end of the ${edge} edge moves toward the middle of the edge, in document pixels (negative: apart). Rounded to whole pixels.`),
      shift: { ...offsetSpec(`How far the ${edge} edge moves down, in document pixels (negative: up). Rounded to whole pixels.`), default: 0 },
    },
  }) as const;

export const layerTransform = defineCommand({
  id: 'layer.transform',
  summary:
    'Turns, scales, skews, distorts or flips whole layers with the Move tool, as its options-bar buttons and transform handles do with no marquee, and applies the step at once: nothing is left pending (a drag ends as Escape does). rotate 90 / -90 are the Rotate 90° CW / CCW buttons, exact with no resampling ("Rotate Layer 90° CW" / "... CCW" for one layer, "Transform" for several); any other angle drags a rotate handle, turning about the centre of the content. scale drags a scale handle by {x, y} factors with `anchor` held still: default "top-left" (the bottom-right corner is dragged); a corner anchor scales both axes, an edge anchor one, and no single drag scales about the centre. skew, distort and perspective press that mode\'s button in the Move options (Skew, Distort, Perspective), drag its handles, and press the button they found pressed again when they are done; rotate and scale do the same with Free. skew shears by {x, y} degrees, one axis a call: an edge handle slides along itself while `anchor`, the edge opposite, holds still (x: "top" by default, or "bottom"; y: "left" by default, or "right"); a positive x leans the bottom to the right of the top, a positive y the right side below the left, up to 60°. distort drags corner handles by pixel offsets, each corner on its own, and the picture stretches to follow: {"top-right": {x: -30, y: 10}} moves that corner 30 px left and 10 px down. perspective drags a corner in Perspective mode, where the other end of that edge mirrors it: {top: {inset: 40}} moves both ends of the top edge 40 px toward its middle (negative: apart), and `shift` moves the edge down (negative: up). flip is the Flip Horizontal / Vertical button, for several layers, a group or a text layer. A drag resamples the pixels and lands on whole document pixels, as a pointer does, so it reaches the angle within 0.01° and the factors or the skew within half a pixel of the box, and corner offsets are rounded to whole pixels; the result says what it reached. Pass `layers` for several layers (selected as a click and Cmd-clicks in the Layers panel do; they are transformed together in one box), `layer` for one, or neither for the layers selected now; the Move tool is selected first, as tool.select does. One raster layer has no handles of its own, so a drag first selects its pixels as a Cmd-click on its thumbnail does and drops the selection after (history.undo brings that selection back with the pixels). A text layer is dragged by its own handles and stays live. Every drag is one history step ("Transform"): one for a rotate, a scale or a skew, one per corner moved for distort (up to four) and one per edge for perspective (up to two), so history.undo takes as many steps. Refused while a marquee is active (select.none with commit: true first), when View > Snap to Grid with the grid shown would change a rotate or scale, in layer-mask edit mode or Quick Mask for raster layers, on a locked layer, for text on a path, for distort or perspective on a text layer or on layers that include one (a text layer has only Free and Skew: layer.rasterize first), when the corners would not stay a convex quad, when a skew would slide its edge less than a pixel, and for a flip of one non-text layer (image.flip-layer does it). Returns the layers transformed, plus `rotate` (degrees), `scale` ({x, y}), `skew` ({x, y} degrees) or `corners` (how far each corner moved, by name) as the drags reached them.',
  surface: 'document',
  params: {
    layer: layerRefSpec,
    layers: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 1000,
      optional: true,
      description: 'Layer ids or exact names, transformed together in one box; the first becomes the active layer.',
    },
    rotate: {
      type: 'number',
      min: -ROTATE_RANGE,
      max: ROTATE_RANGE,
      optional: true,
      description: 'Degrees clockwise, -360 to 360, not 0. 90 and -90 are the exact quarter-turn buttons; any other angle is a rotate-handle drag about the centre of the content.',
    },
    flip: { type: 'string', enum: ['horizontal', 'vertical'], optional: true, description: 'horizontal mirrors left to right; vertical mirrors top to bottom.' },
    scale: {
      type: 'point',
      min: SCALE_MIN,
      max: SCALE_MAX,
      optional: true,
      description: `Factors {x, y}, each ${SCALE_MIN} to ${SCALE_MAX}: {x: 2, y: 2} doubles the size. For a text layer already turned, x and y are along its own axes. With an edge anchor, the axis it does not scale must be 1.`,
    },
    skew: {
      type: 'point',
      min: -SKEW_RANGE,
      max: SKEW_RANGE,
      optional: true,
      description: `Degrees {x, y}, each -${SKEW_RANGE} to ${SKEW_RANGE}, exactly one of them 0. x shears sideways: the top and bottom edges slide apart, the bottom to the right of the top when positive. y shears up and down: the right side below the left when positive. For a text layer already turned, x and y are along its own axes.`,
    },
    distort: {
      type: 'object',
      optional: true,
      description: 'Corner offsets by corner name; a corner left out stays where it is. The corners must stay a convex quad.',
      fields: {
        'top-left': cornerOffsetSpec('top-left'),
        'top-right': cornerOffsetSpec('top-right'),
        'bottom-right': cornerOffsetSpec('bottom-right'),
        'bottom-left': cornerOffsetSpec('bottom-left'),
      },
    },
    perspective: {
      type: 'object',
      optional: true,
      description: 'The top edge, the bottom edge or both, each narrowed (or widened) evenly about its middle: {top: {inset: 40}} makes the picture recede upward.',
      fields: { top: edgePullSpec('top'), bottom: edgePullSpec('bottom') },
    },
    anchor: {
      type: 'string',
      enum: SCALE_ANCHORS,
      optional: true,
      description: 'With scale: the point of the box that stays put; the handle opposite it is dragged. Default "top-left". Corners scale both axes; "left" / "right" scale x only, "top" / "bottom" y only. With skew: the edge that stays put, "top" (the default) or "bottom" for x, "left" (the default) or "right" for y.',
    },
  },
  async run({ layer: ref, layers: refs, ...asked }): Promise<LayerTransformResult> {
    requireDocument();
    const engine = requireEngine();
    const request = parseRequest(asked);
    const layers = targets(ref, refs);
    if (store().selection.active) throw new CommandError('refused', MARQUEE_REFUSAL);
    return afterActivation(() => selectLayers(layers), async () => {
      if (useUIStore.getState().activeTool !== 'move') useUIStore.getState().setActiveTool('move');
      if (request.drag) return dragStep(engine, request.drag);
      return { layers: await buttonStep(engine, request.button ?? {}) };
    });
  },
});
