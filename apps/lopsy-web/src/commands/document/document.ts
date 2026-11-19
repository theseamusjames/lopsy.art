import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { layerSummary, requireDocument, waitForEditorState, type LayerSummary } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getMaxDocumentSide } from '../../engine-wasm/gpu-limits';
import { MAX_DOCUMENT_SIDE } from '../../utils/document-size';
import { rgbToHex } from '../../utils/color';
import type { BlendMode, Color, DocumentColorMode, DocumentState, Layer, Rect } from '../../types';

/** The modes the New Document dialog offers (Indexed is reached through Image > Mode). */
const NEW_DOCUMENT_COLOR_MODES = ['rgb', 'grayscale', 'cmyk', 'lab'] as const satisfies readonly DocumentColorMode[];

/** The New Document dialog's Resolution field accepts 1 to 1200 and defaults to 72. */
const MAX_DPI = 1200;
const DEFAULT_DPI = 72;

const BASELINE_TIMEOUT_MS = 10_000;

const sideSpec = (axis: string) =>
  ({
    type: 'number',
    integer: true,
    min: 1,
    max: MAX_DOCUMENT_SIDE,
    description: `Document ${axis} in pixels. This device may allow less than ${MAX_DOCUMENT_SIDE}: its GPU's largest texture.`,
  }) as const;

export interface NewDocumentResult {
  width: number;
  height: number;
  colorMode: DocumentColorMode;
  /** Bottom to top. */
  layers: LayerSummary[];
  activeLayer: string | null;
}

function orderedLayers(doc: DocumentState): Layer[] {
  const byId = new Map(doc.layers.map((layer) => [layer.id, layer]));
  return doc.layerOrder.map((id) => byId.get(id)).filter((layer): layer is Layer => layer !== undefined);
}

function assertFitsDevice(width: number, height: number): void {
  const maxSide = getMaxDocumentSide();
  if (width <= maxSide && height <= maxSide) return;
  throw new CommandError(
    'invalid',
    `doc.new: width and height must be at most ${maxSide} pixels on this device (its GPU's largest texture), got ${width}x${height}`,
  );
}

/**
 * The first frame the canvas renders for a new document pushes its "New
 * Document" history entry (useCanvasRendering.ts). Until then the document
 * has no history, and an undoable change made first would take its place.
 */
async function baselineEntry(documentVersion: number): Promise<void> {
  await waitForEditorState(
    (state) => state.documentVersion !== documentVersion || state.undoStack.length > 0,
    { timeoutMs: BASELINE_TIMEOUT_MS, waitingFor: 'the new document\'s first frame (its "New Document" history entry)' },
  );
  if (useEditorStore.getState().documentVersion !== documentVersion) {
    throw new CommandError('unavailable', 'Another document replaced the new one before it was ready.');
  }
}

function newDocumentResult(): NewDocumentResult {
  const doc = useEditorStore.getState().document;
  return {
    width: doc.width,
    height: doc.height,
    colorMode: doc.colorMode,
    layers: orderedLayers(doc).map(layerSummary),
    activeLayer: doc.activeLayerId,
  };
}

export const docNew = defineCommand({
  id: 'doc.new',
  summary:
    'Creates a new document, replacing the open one without asking, as the New Document dialog\'s Create does; returns its size, colour mode, layers (bottom to top) and the active layer id.',
  surface: 'document',
  params: {
    width: sideSpec('width'),
    height: sideSpec('height'),
    background: {
      type: 'string',
      enum: ['white', 'transparent'],
      default: 'white',
      description: 'white: a white Background layer with an empty "Layer 1" above it, active. transparent: one empty Background layer.',
    },
    colorMode: { type: 'string', enum: NEW_DOCUMENT_COLOR_MODES, default: 'rgb' },
    dpi: {
      type: 'number',
      integer: true,
      min: 1,
      max: MAX_DPI,
      default: DEFAULT_DPI,
      description: 'Pixels per inch. Only the rulers\' inch units read it.',
    },
  },
  run({ width, height, background, colorMode, dpi }) {
    assertFitsDevice(width, height);
    useEditorStore.getState().createDocument(width, height, background === 'transparent', colorMode, dpi);
    useUIStore.getState().closeModalOfKind('newDocument');
    return baselineEntry(useEditorStore.getState().documentVersion).then(newDocumentResult);
  },
});

export interface LayerInfo {
  id: string;
  name: string;
  type: Layer['type'];
  visible: boolean;
  locked: boolean;
  /** Percent, 0-100, as the Layers panel shows it. */
  opacity: number;
  blendMode: BlendMode;
  x: number;
  y: number;
  /** Pixels. Null for groups; for text, width is the text box's (null for point text) and height is null. */
  width: number | null;
  height: number | null;
  hasMask: boolean;
  /** The id of the group holding this layer; null for the root group. */
  parent: string | null;
  isActive: boolean;
  isSelected: boolean;
}

export interface DocumentInfo {
  name: string;
  width: number;
  height: number;
  colorMode: DocumentColorMode;
  dpi: number;
  /** Bottom to top. */
  layers: LayerInfo[];
  selection: { active: boolean; bounds: Rect | null };
  history: { undo: string[]; redo: string[] };
  foregroundColor: string;
  backgroundColor: string;
  activeTool: string;
}

function parentIds(layers: readonly Layer[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const layer of layers) {
    if (layer.type !== 'group') continue;
    for (const child of layer.children) parents.set(child, layer.id);
  }
  return parents;
}

function layerSize(layer: Layer): { width: number | null; height: number | null } {
  if (layer.type === 'group') return { width: null, height: null };
  if (layer.type === 'text') return { width: layer.width, height: null };
  return { width: layer.width, height: layer.height };
}

function layerInfo(layer: Layer, doc: DocumentState, parents: Map<string, string>): LayerInfo {
  return {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    visible: layer.visible,
    locked: layer.locked,
    opacity: Math.round(layer.opacity * 100),
    blendMode: layer.blendMode,
    x: layer.x,
    y: layer.y,
    ...layerSize(layer),
    hasMask: layer.mask !== null,
    parent: parents.get(layer.id) ?? null,
    isActive: layer.id === doc.activeLayerId,
    isSelected: doc.selectedLayerIds.includes(layer.id),
  };
}

function colorHex(color: Color): string {
  return rgbToHex({ ...color, r: Math.round(color.r), g: Math.round(color.g), b: Math.round(color.b) });
}

export const docInfo = defineCommand({
  id: 'doc.info',
  summary:
    'Describes the open document: name, size, colour mode, dpi, every layer (bottom to top, with ids), the selection, the undo and redo history labels, the foreground and background colours and the active tool.',
  surface: 'document',
  params: {},
  run(): DocumentInfo {
    const doc = requireDocument();
    const state = useEditorStore.getState();
    const tools = useToolSettingsStore.getState();
    const parents = parentIds(doc.layers);
    const { selection } = state;
    return {
      name: doc.name,
      width: doc.width,
      height: doc.height,
      colorMode: doc.colorMode,
      dpi: doc.dpi ?? DEFAULT_DPI,
      layers: orderedLayers(doc).map((layer) => layerInfo(layer, doc, parents)),
      selection: {
        active: selection.active,
        bounds: selection.active && selection.bounds ? { ...selection.bounds } : null,
      },
      history: {
        undo: state.undoStack.map((entry) => entry.label),
        redo: state.redoStack.map((entry) => entry.label),
      },
      foregroundColor: colorHex(tools.foregroundColor),
      backgroundColor: colorHex(tools.backgroundColor),
      activeTool: useUIStore.getState().activeTool,
    };
  },
});
