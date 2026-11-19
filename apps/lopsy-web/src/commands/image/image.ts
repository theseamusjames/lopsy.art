import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { activateIfOther, layerRefSpec, parseHexColor, requireDocument, requireEngine, resolveLayer } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { layerCreationRefusal } from '../../app/store/document-slice';
import { cropToSelection } from '../../app/crop-to-selection';
import {
  applyAutoColor,
  applyAutoContrast,
  applyAutoTone,
  flipActiveLayer,
  flipRefusal,
  getActiveGroupId,
  rotateImage,
} from '../../app/image-actions';
import { anchorWords, CANVAS_ANCHORS, type CanvasAnchor } from '../../components/CanvasSizeModal/canvas-anchor';
import { describeBorderPlan } from '../../components/BorderModal/border-plan';
import { planBorder, uniformBorderWidths, type BorderCorners, type BorderWidths } from '../../layers/border';
import { getMaxDocumentSide } from '../../engine-wasm/gpu-limits';
import { MAX_DOCUMENT_SIDE } from '../../utils/document-size';
import type { Color } from '../../types';

export interface SizeResult {
  width: number;
  height: number;
}

function store() {
  return useEditorStore.getState();
}

function size(): SizeResult {
  const { width, height } = store().document;
  return { width, height };
}

/** The undo stack's top entry, to tell whether an operation that may stop silently pushed one. */
function topEntry(): unknown {
  const { undoStack } = store();
  return undoStack[undoStack.length - 1];
}

const sideSpec = (axis: string) =>
  ({
    type: 'number',
    integer: true,
    min: 1,
    max: MAX_DOCUMENT_SIDE,
    description: `New document ${axis} in pixels. This device may allow less than ${MAX_DOCUMENT_SIDE}: its GPU's largest texture.`,
  }) as const;

function assertFitsDevice(commandId: string, width: number, height: number): void {
  const maxSide = getMaxDocumentSide();
  if (width <= maxSide && height <= maxSide) return;
  throw new CommandError('invalid', `${commandId}: width and height must be at most ${maxSide} pixels on this device (its GPU's largest texture), got ${width}x${height}`);
}

function anchorName(anchor: CanvasAnchor): string {
  return anchorWords(anchor).join('-');
}

const ANCHOR_NAMES = CANVAS_ANCHORS.map(anchorName);

function anchorNamed(name: string): CanvasAnchor {
  const anchor = CANVAS_ANCHORS.find((candidate) => anchorName(candidate) === name);
  if (!anchor) throw new Error(`image.canvas-size: no anchor ${name}`);
  return anchor;
}

export const imageCanvasSize = defineCommand({
  id: 'image.canvas-size',
  summary:
    'Changes the canvas size without scaling the content, as Image > Canvas Size...\'s Apply does with pixel units ("Resize Canvas"): the anchor is the cell of the dialog\'s 3x3 grid the old canvas keeps to, and layers, masks, paths and guides move with it. Returns the new size.',
  surface: 'document',
  params: {
    width: sideSpec('width'),
    height: sideSpec('height'),
    anchor: {
      type: 'string',
      enum: ANCHOR_NAMES,
      default: 'center-middle',
      description: 'The anchor grid cell, horizontal then vertical, as the dialog\'s buttons name them ("Anchor left top" is left-top).',
    },
  },
  run({ width, height, anchor }): SizeResult {
    requireDocument();
    assertFitsDevice('image.canvas-size', width, height);
    const { x, y } = anchorNamed(anchor);
    store().resizeCanvas(width, height, x, y);
    return size();
  },
});

export const imageSize = defineCommand({
  id: 'image.size',
  summary:
    'Scales the whole image to a new size in pixels, as Image > Image Size...\'s Apply does ("Resize Image"); layers, masks, text, paths and guides scale with it. The dialog\'s Constrain proportions only links its own fields: pass both sides. Returns the new size.',
  surface: 'document',
  params: { width: sideSpec('width'), height: sideSpec('height') },
  run({ width, height }): SizeResult {
    requireDocument();
    assertFitsDevice('image.size', width, height);
    store().resizeImage(width, height);
    return size();
  },
});

const pixelsSpec = (what: string, fallback?: number) =>
  ({ type: 'number', integer: true, min: 0, ...(fallback === undefined ? {} : { default: fallback }), description: `${what} in pixels.` }) as const;

const DEFAULT_BORDER_WIDTH = 20;

function borderColor(hex: string | undefined): Color {
  if (hex === undefined) return useToolSettingsStore.getState().foregroundColor;
  return parseHexColor('image.border', 'color', hex);
}

function borderWidths(width: number | undefined, widths: BorderWidths | undefined): BorderWidths {
  if (width !== undefined && widths !== undefined) {
    throw new CommandError('invalid', 'image.border: pass width (every side alike) or widths (each side), not both');
  }
  return widths ?? uniformBorderWidths(width ?? DEFAULT_BORDER_WIDTH);
}

export interface BorderResult extends SizeResult {
  /** The new Border layer's id. */
  layer: string;
}

export const imageBorder = defineCommand({
  id: 'image.border',
  summary:
    'Frames the canvas with a solid border on a new "Border" layer, as Image > Border...\'s Apply does ("Border"): expand grows the canvas by the widths and puts the layer under the content (or over it, with a window, when the window is rounded); overlay keeps the size and covers the edges. Refused, with the dialog\'s message, when every width is 0 or the canvas would outgrow the device, and in an Indexed document. Returns the Border layer id and the canvas size.',
  surface: 'document',
  params: {
    width: { ...pixelsSpec('Every side\'s width (the dialog\'s Symmetric field), default 20'), optional: true },
    widths: {
      type: 'object',
      optional: true,
      description: 'Each side\'s width, as the dialog\'s Asymmetric fields; sides left out are 20.',
      fields: {
        top: pixelsSpec('Top width', DEFAULT_BORDER_WIDTH),
        right: pixelsSpec('Right width', DEFAULT_BORDER_WIDTH),
        bottom: pixelsSpec('Bottom width', DEFAULT_BORDER_WIDTH),
        left: pixelsSpec('Left width', DEFAULT_BORDER_WIDTH),
      },
    },
    placement: { type: 'string', enum: ['expand', 'overlay'], default: 'expand', description: 'expand ("Expand canvas") or overlay ("Overlay").' },
    innerRadius: pixelsSpec('Radius of the window\'s corners ("Inner radius")', 0),
    outerRadius: pixelsSpec('Radius of the canvas\'s corners ("Outer radius")', 0),
    color: {
      type: 'color',
      optional: true,
      description: 'The border colour, "#rrggbb" or "#rrggbbaa", passed to the border as the dialog passes its picked colour: unconverted, in any colour mode. Omitted means the foreground colour, as the dialog opens with.',
    },
  },
  run({ width, widths, placement, innerRadius, outerRadius, color: hex }): BorderResult {
    const doc = requireDocument();
    const sides = borderWidths(width, widths);
    const corners: BorderCorners = { outer: outerRadius, inner: innerRadius };
    const color = borderColor(hex);
    const refusal = layerCreationRefusal(doc);
    if (refusal) throw refusalError(refusal);
    requireEngine();
    if (!planBorder(doc.width, doc.height, sides, placement, getMaxDocumentSide(), corners)) {
      throw new CommandError('refused', describeBorderPlan(null, sides, doc.width, doc.height));
    }
    const before = new Set(doc.layers.map((layer) => layer.id));
    store().addBorder(color, sides, placement, corners);
    const added = store().document.layers.find((layer) => !before.has(layer.id));
    if (!added) throw new Error('image.border: no Border layer was added');
    return { layer: added.id, ...size() };
  },
});

const cropParams = {
  x: { type: 'number', integer: true, description: 'Left edge of the kept area in document pixels; (0,0) is the top-left of the document.' },
  y: { type: 'number', integer: true, description: 'Top edge of the kept area in document pixels.' },
  width: { type: 'number', integer: true, min: 1, description: 'Width of the kept area in pixels.' },
  height: { type: 'number', integer: true, min: 1, description: 'Height of the kept area in pixels.' },
} as const;

export const imageCrop = defineCommand({
  id: 'image.crop',
  summary:
    'Crops the canvas to a rectangle, as releasing a Crop-tool drag does ("Crop Canvas"): the part outside the canvas is cut off the rectangle, layers, masks, paths and guides move with the crop, and the selection is kept. Returns the new size.',
  surface: 'document',
  params: cropParams,
  run({ x, y, width, height }): SizeResult {
    const doc = requireDocument();
    const isInside = Math.min(doc.width, x + width) > Math.max(0, x) && Math.min(doc.height, y + height) > Math.max(0, y);
    if (!isInside) throw new CommandError('refused', `The crop rectangle lies outside the ${doc.width}x${doc.height} canvas.`);
    store().cropCanvas({ x, y, width, height });
    return size();
  },
});

export const imageCropToSelection = defineCommand({
  id: 'image.crop-to-selection',
  summary:
    'Crops the canvas to the selection\'s bounds and drops the selection, as Edit > Crop does ("Crop Canvas"). Refused with nothing selected, where the menu item is disabled. Returns the new size.',
  surface: 'document',
  params: {},
  enabled(): boolean {
    return store().selection.active;
  },
  run(): SizeResult {
    requireDocument();
    if (!store().selection.active || !store().selection.bounds) throw new CommandError('refused', 'Nothing is selected to crop to.');
    cropToSelection();
    return size();
  },
});

export const imageRotate = defineCommand({
  id: 'image.rotate',
  summary:
    'Turns the whole image a quarter turn, as Image > Rotate 90° CW / CCW does ("Rotate Image 90° CW" / "... CCW"): the document\'s width and height swap and every layer, mask, live text layer, path and guide turns with it. Returns the new size.',
  surface: 'document',
  params: { direction: { type: 'string', enum: ['cw', 'ccw'], description: 'cw: clockwise. ccw: counter-clockwise.' } },
  run({ direction }): SizeResult {
    requireDocument();
    requireEngine();
    rotateImage(direction);
    return size();
  },
});

export const imageFlipLayer = defineCommand({
  id: 'image.flip-layer',
  summary:
    'Mirrors one layer (not the whole image), as Image > Flip Horizontal / Vertical does ("Flip Horizontal" / "Flip Vertical"): a raster layer mirrors about its own content with its mask, an upright text layer flips its transform and stays editable, and a group flips its layers as one. Naming a layer makes it active first, as clicking its row does. Refused, with the text the menu toasts, for text on a path and for a group holding live text, and when there is nothing to flip. Returns the layer id.',
  surface: 'document',
  params: {
    layer: layerRefSpec,
    axis: { type: 'string', enum: ['horizontal', 'vertical'], description: 'horizontal mirrors left to right; vertical mirrors top to bottom.' },
  },
  run({ layer: ref, axis }): Promise<{ layer: string }> {
    const doc = requireDocument();
    const layer = resolveLayer(ref);
    requireEngine();
    const refusal = flipRefusal(layer, doc.layers);
    if (refusal) throw refusalError(refusal);
    activateIfOther(layer.id);
    const before = topEntry();
    return flipActiveLayer(axis).then(() => {
      if (topEntry() === before) throw new CommandError('refused', `"${layer.name}" has nothing to flip.`);
      return { layer: layer.id };
    });
  },
});

const AUTO = {
  tone: { apply: applyAutoTone, label: 'Auto Tone' },
  contrast: { apply: applyAutoContrast, label: 'Auto Contrast' },
  color: { apply: applyAutoColor, label: 'Auto Color' },
} as const;

export interface AutoResult {
  /** The adjustment node added. */
  node: string;
  /** The group it was added to. */
  group: string;
}

function lastNodeId(groupId: string): string | null {
  const group = store().document.layers.find((layer) => layer.id === groupId);
  if (!group || group.type !== 'group') return null;
  return group.adjustments[group.adjustments.length - 1]?.id ?? null;
}

export const imageAuto = defineCommand({
  id: 'image.auto',
  summary:
    'Reads the active layer and appends the correcting adjustment node to the active group (or the root group), as Image > Auto Tone / Auto Contrast / Auto Color does ("Auto Tone" / "Auto Contrast" / "Auto Color"): tone and contrast add a levels node, color a curves node. The layer\'s own pixels are untouched. Returns the node id and its group id.',
  surface: 'document',
  params: { kind: { type: 'string', enum: ['tone', 'contrast', 'color'] } },
  run({ kind }): Promise<AutoResult> {
    requireDocument();
    requireEngine();
    const group = getActiveGroupId();
    if (!group) throw new CommandError('refused', 'The document has no group to hold the adjustment.');
    const nodeBefore = lastNodeId(group);
    const { apply, label } = AUTO[kind];
    return apply().then(() => {
      const node = lastNodeId(group);
      if (!node || node === nodeBefore) throw new CommandError('refused', `${label} could not read the active layer's pixels.`);
      return { node, group };
    });
  },
});
