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
import type { Layer } from '../../types';

export interface LayerTransformResult {
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

function parseStep(rotate: number | undefined, flip: Axis | undefined): Step {
  if ((rotate === undefined) === (flip === undefined)) {
    throw new CommandError('invalid', 'layer.transform: pass exactly one of rotate or flip.');
  }
  if (flip) return { flip };
  if (rotate === 90) return { rotate: 'cw' };
  if (rotate === -90) return { rotate: 'ccw' };
  throw new CommandError(
    'invalid',
    `layer.transform: rotate must be 90 or -90 (the Move options' quarter-turn buttons), got ${rotate}; turning by other angles and scaling are handle drags, which tool.gesture performs with the move tool.`,
  );
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

export const layerTransform = defineCommand({
  id: 'layer.transform',
  summary:
    'Turns a quarter turn or flips whole layers about the centre of their content, as the Move tool\'s options-bar buttons (Rotate 90° CW / CCW, Flip Horizontal / Vertical) do with no marquee: one layer turns on its own ("Rotate Layer 90° CW" / "... CCW"), several layers or a group turn or flip together in one box ("Transform"), and a text layer stays live and editable ("Rotate Layer 90° ..." or "Transform"). The step is applied at once: nothing is left pending. Pass `layers` for several layers (selected as a click and Cmd-clicks in the Layers panel do), `layer` for one, or neither for the layers selected now; the Move tool is selected first, as tool.select does. Exactly one of rotate or flip. Arbitrary angles and scaling are handle drags (tool.gesture with the move tool). Refused while a marquee is active (the buttons would transform the selected pixels: select.none first, or tool.gesture), for a flip of one non-text layer (no button: image.flip-layer does it), and for text the step cannot keep live. Returns the layers transformed.',
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
    rotate: { type: 'number', optional: true, description: 'Degrees clockwise: 90 or -90.' },
    flip: { type: 'string', enum: ['horizontal', 'vertical'], optional: true, description: 'horizontal mirrors left to right; vertical mirrors top to bottom.' },
  },
  async run({ layer: ref, layers: refs, rotate, flip }): Promise<LayerTransformResult> {
    requireDocument();
    const engine = requireEngine();
    const step = parseStep(rotate, flip);
    const layers = targets(ref, refs);
    if (store().selection.active) {
      throw new CommandError(
        'refused',
        'A marquee is active, and the Move buttons would transform the selected pixels instead of the layers: deselect first (select.none with commit: true), or transform the selection with tool.gesture and the move tool.',
      );
    }
    return afterActivation(() => selectLayers(layers), async () => {
      if (useUIStore.getState().activeTool !== 'move') useUIStore.getState().setActiveTool('move');
      const before = topEntry();
      const ids = wantsBox() ? await boxStep(engine, step) : await singleStep(step);
      if (topEntry() === before) throw new CommandError('refused', 'Nothing was transformed: the layers have no content to turn or flip.');
      return { layers: ids };
    });
  },
});
