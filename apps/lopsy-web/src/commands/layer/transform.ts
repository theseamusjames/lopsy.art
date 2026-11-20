import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { afterActivation, layerRefSpec, requireDocument, requireEngine, resolveLayer, selectReplace } from '../context';
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
import { dragTransform, type DragOutcome, type DragStep } from './transform-drag';
import { SCALE_ANCHORS, anchorAxes, type ScaleAnchor } from './transform-geometry';

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

interface Request {
  /** A Move-options button step: a quarter turn or a flip. */
  button?: Step;
  /** A handle drag: any other turn, or a scale. */
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

function parseRequest(rotate: number | undefined, flip: Axis | undefined, scale: Point | undefined, anchor: ScaleAnchor | undefined): Request {
  const given = [rotate, flip, scale].filter((v) => v !== undefined).length;
  if (given !== 1) throw new CommandError('invalid', 'layer.transform: pass exactly one of rotate, flip or scale.');
  if (anchor !== undefined && scale === undefined) throw new CommandError('invalid', 'layer.transform: anchor goes with scale only.');
  if (flip) return { button: { flip } };
  if (scale) return { drag: parseScale(scale, anchor ?? 'top-left') };
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

export const layerTransform = defineCommand({
  id: 'layer.transform',
  summary:
    'Turns, scales or flips whole layers with the Move tool, as its options-bar buttons and transform handles do with no marquee, and applies the step at once: nothing is left pending (a drag ends as Escape does). rotate 90 / -90 are the Rotate 90° CW / CCW buttons, exact with no resampling ("Rotate Layer 90° CW" / "... CCW" for one layer, "Transform" for several); any other angle drags a rotate handle, turning about the centre of the content. scale drags a scale handle by {x, y} factors with `anchor` held still: default "top-left" (the bottom-right corner is dragged); a corner anchor scales both axes, an edge anchor one, and no single drag scales about the centre. flip is the Flip Horizontal / Vertical button, for several layers, a group or a text layer. A drag resamples the pixels and lands on whole document pixels, as a pointer does, so it reaches the angle within 0.01° and the factors within half a pixel of the box; the result says what it reached. Pass `layers` for several layers (selected as a click and Cmd-clicks in the Layers panel do; they turn and scale together in one box), `layer` for one, or neither for the layers selected now; the Move tool is selected first, as tool.select does. One raster layer has no handles of its own, so a drag first selects its pixels as a Cmd-click on its thumbnail does and drops the selection after (history.undo brings that selection back with the pixels). A text layer is dragged by its own handles and stays live. Every drag is one history step ("Transform"). Refused while a marquee is active (select.none with commit: true first), when View > Snap to Grid with the grid shown would change the result, in layer-mask edit mode or Quick Mask for raster layers, on a locked layer, for text on a path, for a flip of one non-text layer (image.flip-layer does it), and when the Move options are in another mode than Free where that mode changes the drag. Returns the layers transformed, plus `rotate` (degrees) or `scale` ({x, y}) as the drag reached them.',
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
    anchor: {
      type: 'string',
      enum: SCALE_ANCHORS,
      optional: true,
      description: 'With scale: the point of the box that stays put; the handle opposite it is dragged. Default "top-left". Corners scale both axes; "left" / "right" scale x only, "top" / "bottom" y only.',
    },
  },
  async run({ layer: ref, layers: refs, rotate, flip, scale, anchor }): Promise<LayerTransformResult> {
    requireDocument();
    const engine = requireEngine();
    const request = parseRequest(rotate, flip, scale, anchor);
    const layers = targets(ref, refs);
    if (store().selection.active) throw new CommandError('refused', MARQUEE_REFUSAL);
    return afterActivation(() => selectLayers(layers), async () => {
      if (useUIStore.getState().activeTool !== 'move') useUIStore.getState().setActiveTool('move');
      if (request.drag) return dragStep(engine, request.drag);
      return { layers: await buttonStep(engine, request.button ?? {}) };
    });
  },
});
