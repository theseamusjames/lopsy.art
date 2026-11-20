import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { boundedPointSpec, coordinateSpec, extentSpec, layerRefSpec, requireDocument, requireEngine, resolveLayer } from '../context';
import { MAX_GESTURE_POINTS } from '../gesture/run-gesture';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import {
  commitLassoPolygon,
  commitMarqueeShape,
  constrainMarqueeSize,
} from '../../app/interactions/selection-handlers';
import {
  EMPTY_MODIFIED_SELECTION,
  invertSelectionAction,
  modifySelection,
  selectAll,
  selectionToPathAction,
} from '../../app/selection-actions';
import { selectLayerAlpha } from '../../panels/LayerPanel/layer-selection';
import { deselectAndCommit } from '../../app/interactions/deselect-and-commit';
import type { SelectionCombineMode } from '../../selection/selection';
import type { Rect } from '../../types';

export interface SelectionResult {
  active: boolean;
  /** The selection's bounds in document pixels, or null when nothing is selected. */
  bounds: Rect | null;
}

function store() {
  return useEditorStore.getState();
}

function refuse(reason: string): never {
  throw new CommandError('refused', reason);
}

function selectionResult(): SelectionResult {
  const { selection } = store();
  return { active: selection.active, bounds: selection.active && selection.bounds ? { ...selection.bounds } : null };
}

function requireSelection(what: string): void {
  const { selection } = store();
  if (!selection.active || !selection.mask) refuse(`Nothing is selected to ${what}.`);
}

const modeSpec = {
  type: 'string',
  enum: ['replace', 'add', 'subtract', 'intersect'],
  default: 'replace',
  description:
    'How the new shape combines with the current selection, as the modifier keys do with the tool: replace (no key), add (Shift), subtract (Alt), intersect (Shift+Alt). With nothing selected every mode replaces, as with the tool.',
} as const;

/** As many corners as a gesture command takes points. */
export const MAX_POLYGON_POINTS = MAX_GESTURE_POINTS;

const boxParams = {
  x: coordinateSpec('Left edge in document pixels; (0,0) is the top-left of the document.'),
  y: coordinateSpec('Top edge in document pixels.'),
  width: extentSpec('Width in document pixels.'),
  height: extentSpec('Height in document pixels.'),
  mode: modeSpec,
} as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: SelectionCombineMode;
}

/** The box a drag from (x,y) towards the bottom-right releases, with the ambient Fixed Ratio applied. */
function marqueeBox({ x, y, width, height }: Box): Rect {
  const { aspectRatioLocked, aspectRatioW, aspectRatioH } = useToolSettingsStore.getState();
  const { w, h } = constrainMarqueeSize(width, height, {
    metaPressed: false,
    aspectRatioLocked,
    aspectRatioW,
    aspectRatioH,
  });
  return { x, y, width: w, height: h };
}

async function commitBox(shape: 'rect' | 'ellipse', params: Box): Promise<SelectionResult> {
  const doc = requireDocument();
  const rect = marqueeBox(params);
  const overlaps = rect.x < doc.width && rect.y < doc.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
  if (!overlaps) refuse(`The box does not overlap the ${doc.width}x${doc.height} document.`);
  await commitMarqueeShape(shape, rect, params.mode);
  return selectionResult();
}

const AMBIENT =
  'It uses the current tool options as the tool does: the marquee Feather radius softens the new shape, and a locked Fixed Ratio constrains the box as a drag towards the bottom-right would.';

export const selectRect = defineCommand({
  id: 'select.rect',
  summary: `Selects a rectangle, as releasing a Rectangular Marquee drag over that box does (the box is clipped to the document; add/subtract/intersect are one history step each). ${AMBIENT} Returns whether a selection is active and its bounds.`,
  surface: 'document',
  params: boxParams,
  run: (params): Promise<SelectionResult> => commitBox('rect', params),
});

export const selectEllipse = defineCommand({
  id: 'select.ellipse',
  summary: `Selects the ellipse inscribed in a box, as releasing an Elliptical Marquee drag over that box does (clipped to the document; add/subtract/intersect are one history step each). ${AMBIENT} Returns whether a selection is active and its bounds.`,
  surface: 'document',
  params: boxParams,
  run: (params): Promise<SelectionResult> => commitBox('ellipse', params),
});

export const selectPolygon = defineCommand({
  id: 'select.polygon',
  summary:
    'Selects the polygon through `points`, as closing a Lasso drag through them does (clipped to the document; add/subtract/intersect are one history step each). The marquee Feather radius in the tool options softens the new shape, as it does for the Lasso. Returns whether a selection is active and its bounds.',
  surface: 'document',
  params: {
    points: {
      type: 'array',
      items: boundedPointSpec('A corner.'),
      minItems: 3,
      maxItems: MAX_POLYGON_POINTS,
      description: `The polygon's corners in document pixels, in order; it is closed back to the first point. At most ${MAX_POLYGON_POINTS}.`,
    },
    mode: modeSpec,
  },
  async run({ points, mode }): Promise<SelectionResult> {
    requireDocument();
    const pending = commitLassoPolygon(points.map((p) => ({ x: p.x, y: p.y })), mode);
    if (!pending) refuse('The polygon covers no pixel of the document.');
    await pending;
    return selectionResult();
  },
});

export const selectAllCommand = defineCommand({
  id: 'select.all',
  summary: 'Selects the whole document, as Select > All does (no history step). Returns whether a selection is active and its bounds.',
  surface: 'document',
  params: {},
  run(): SelectionResult {
    requireDocument();
    selectAll();
    return selectionResult();
  },
});

export const selectNone = defineCommand({
  id: 'select.none',
  summary:
    'Drops the selection (no history step). With commit false (the default) it is Select > Deselect, which only drops the selection: a pending Move-tool float or multi-layer transform stays live. With commit true it is Cmd+D or Escape: the transform box goes too and a pending Move float or layer transform is committed into its layer. API callers that want a clean state should pass commit: true. Returns whether a selection is active and its bounds.',
  surface: 'document',
  params: {
    commit: {
      type: 'boolean',
      default: false,
      description: 'false: Select > Deselect. true: Cmd+D / Escape, which also commit a pending Move float or layer transform.',
    },
  },
  run({ commit }): SelectionResult {
    requireDocument();
    if (commit) deselectAndCommit();
    else store().clearSelection();
    return selectionResult();
  },
});

export const selectInvert = defineCommand({
  id: 'select.invert',
  summary:
    'Inverts the selection, as Select > Inverse and Cmd+Shift+I do ("Inverse Selection"): a pending Move-tool float is committed first, even with nothing selected, which is then refused. Inverting a selection of everything leaves an active, empty selection framed by the whole document, as the menu does. Returns whether a selection is active and its bounds.',
  surface: 'document',
  params: {},
  run(): SelectionResult {
    requireDocument();
    if (!invertSelectionAction()) refuse('Nothing is selected to invert.');
    return selectionResult();
  },
});

export const selectModify = defineCommand({
  id: 'select.modify',
  summary:
    'Grows, shrinks or feathers the selection, as Apply in the Select > Grow…, Shrink… or Feather… dialog does ("Grow Selection", "Shrink Selection", "Feather Selection"): a pending Move-tool float is committed first, even with nothing selected, which is then refused. Refused, with the selection kept, when no pixel would remain selected. Returns whether a selection is active and its bounds.',
  surface: 'document',
  params: {
    kind: { type: 'string', enum: ['grow', 'shrink', 'feather'] },
    amount: {
      type: 'number',
      integer: true,
      min: 1,
      max: 250,
      description: 'Pixels: 1 to 100 for grow and shrink (the dialog\'s Amount), 1 to 250 for feather (its Radius).',
    },
  },
  async run({ kind, amount }): Promise<SelectionResult> {
    requireDocument();
    if (kind !== 'feather' && amount > 100) {
      throw new CommandError('invalid', `select.modify: amount must be from 1 to 100 for ${kind}, got ${amount}`);
    }
    const outcome = await modifySelection(kind, amount);
    if (outcome === 'empty') throw refusalError(EMPTY_MODIFIED_SELECTION);
    if (outcome === 'no-selection') refuse(`Nothing is selected to ${kind}.`);
    if (outcome === 'stale') refuse('The selection changed while the feather was being computed; the newer selection was kept.');
    return selectionResult();
  },
});

export const selectFromLayer = defineCommand({
  id: 'select.from-layer',
  summary:
    'Selects a layer\'s opaque pixels (partly transparent pixels partly), as Cmd/Ctrl-clicking its thumbnail in the Layers panel does; Shift, Alt and Shift+Alt on that click are the add, subtract and intersect modes. Returns whether a selection is active and its bounds.',
  surface: 'document',
  params: { layer: layerRefSpec, mode: modeSpec },
  async run({ layer: ref, mode }): Promise<SelectionResult> {
    requireDocument();
    const layer = resolveLayer(ref);
    if (layer.type === 'group') refuse(`"${layer.name}" is a group: groups have no thumbnail to select pixels from.`);
    requireEngine();
    const before = store().selection.mask;
    await selectLayerAlpha(layer.id, { combine: mode });
    if (store().selection.mask === before) refuse(`"${layer.name}" has no opaque pixels: the selection was not changed.`);
    return selectionResult();
  },
});

export const selectToPath = defineCommand({
  id: 'select.to-path',
  summary:
    'Traces the selection\'s outline into new paths, as Select > Selection → Path does ("Selection to Path"); the selection is kept. Returns whether a selection is active and its bounds.',
  surface: 'document',
  params: {},
  enabled(): boolean {
    return store().selection.active;
  },
  run(): SelectionResult {
    requireDocument();
    requireSelection('turn into a path');
    if (selectionToPathAction() === 0) refuse('The selection has no outline to trace.');
    return selectionResult();
  },
});
