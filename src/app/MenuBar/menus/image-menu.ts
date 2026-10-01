import { useEditorStore } from '../../editor-store';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  flipLayer,
  getLayerContentBounds,
  getLayerEngineBounds,
  rotateLayer90,
  setDocumentSize,
} from '../../../engine-wasm/wasm-bridge';
import { readLayerAsImageData } from '../../../engine-wasm/gpu-pixel-access';
import { pixelDataManager } from '../../../engine/pixel-data-manager';
import { computeAutoTone, computeAutoContrast, computeAutoColor } from '../../../filters/auto-enhance';
import type { Layer, GroupLayer, DocumentColorMode, TextLayer } from '../../../types';
import { measureTextFrame, placeTextLayerAtAnchor } from '../../../engine-wasm/engine-sync';
import { transformTextLayerInDocument } from '../../text-layer-transform';
import { notifyInfo } from '../../notifications-store';
import {
  applyDocumentLinear,
  FLIP_HORIZONTAL,
  FLIP_VERTICAL,
  placementProps,
  ROTATE_CCW,
  ROTATE_CW,
  textTransformFor,
} from '../../../tools/text/text-transform';
import type { AdjustmentNode } from '../../../types/adjustment-nodes';
import type { MenuDef, MenuItem } from './types';
import type { Engine } from '../../../engine-wasm/wasm-bridge';
import { rotatedTextureOrigin, type Rect } from '../../../layers/rotate-90';
import { planGroupFlip, type FlipAxis, type GroupFlipMember } from '../../../layers/flip';
import { getDescendantIds } from '../../../layers/group-utils';
import { flushLayerSync } from '../../../engine-wasm/engine-sync';
import { clearJsPixelData } from '../../store/clear-js-pixel-data';

const GROUP_TEXT_FLIP_REFUSAL = 'Rasterize the text layers in this group before flipping it.';

function flipLabel(axis: FlipAxis): string {
  return axis === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical';
}

export function flipActiveLayer(axis: FlipAxis): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  const layer = state.document.layers.find((l) => l.id === activeId);
  if (!layer) return;
  // A text layer flips through its transform, so it stays editable.
  if (layer.type === 'text') {
    const flip = axis === 'horizontal' ? FLIP_HORIZONTAL : FLIP_VERTICAL;
    if (!transformTextLayerInDocument(activeId, flip, flipLabel(axis))) {
      notifyInfo('Rasterize this text layer to flip it.');
    }
    return;
  }
  if (layer.type === 'group') {
    flipGroup(engine, layer, axis);
    return;
  }

  state.pushHistory(flipLabel(axis));
  flipLayer(engine, activeId, axis === 'horizontal');

  // GPU is now source of truth — clear stale JS pixel data.
  pixelDataManager.remove(activeId);
  const dirtyIds = new Set(state.dirtyLayerIds);
  dirtyIds.add(activeId);
  useEditorStore.setState({ dirtyLayerIds: dirtyIds });
  state.notifyRender();
}

/**
 * A group has no pixels of its own, so it flips as a unit: each descendant
 * texture is mirrored in place and moved to the mirror of its position
 * within the group's combined content bounds.
 */
function flipGroup(engine: Engine, group: GroupLayer, axis: FlipAxis): void {
  const state = useEditorStore.getState();
  const byId = new Map(state.document.layers.map((l) => [l.id, l]));
  const leaves = getDescendantIds(state.document.layers, group.id)
    .map((id) => byId.get(id))
    .filter((l): l is Layer => l !== undefined && l.type !== 'group');
  if (leaves.some((l) => l.type === 'text')) {
    notifyInfo(GROUP_TEXT_FLIP_REFUSAL);
    return;
  }
  if (leaves.length === 0) return;

  // Push pending store positions and JS pixels to the engine so the texture
  // rects and content bounds read below are current.
  flushLayerSync(state);
  const members: GroupFlipMember[] = leaves.map((l) => {
    const [, , width = 0, height = 0] = getLayerEngineBounds(engine, l.id);
    return { id: l.id, texture: { x: l.x, y: l.y, width, height }, content: readContentRect(engine, l.id) };
  });
  const origins = planGroupFlip(members, axis);
  if (origins.size === 0) return;

  state.pushHistory(flipLabel(axis));
  for (const id of origins.keys()) flipLayer(engine, id, axis === 'horizontal');

  useEditorStore.setState((s) => ({
    document: {
      ...s.document,
      layers: s.document.layers.map((l) => {
        const origin = origins.get(l.id);
        return origin ? ({ ...l, x: origin.x, y: origin.y } as Layer) : l;
      }),
    },
    renderVersion: s.renderVersion + 1,
  }));
  for (const id of origins.keys()) clearJsPixelData(id);
}

/** Opaque-content rect of a layer, texture-local; null when the layer is empty. */
function readContentRect(engine: Engine, layerId: string): Rect | null {
  const bounds = getLayerContentBounds(engine, layerId);
  if (bounds.length < 4) return null;
  const width = bounds[2]!;
  const height = bounds[3]!;
  if (width <= 0 || height <= 0) return null;
  return { x: bounds[0]!, y: bounds[1]!, width, height };
}

export function rotateActiveLayer(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  const layer = state.document.layers.find((l) => l.id === activeId);
  const label = direction === 'cw' ? 'Rotate Layer 90° CW' : 'Rotate Layer 90° CCW';
  if (layer?.type === 'text') {
    if (!transformTextLayerInDocument(activeId, direction === 'cw' ? ROTATE_CW : ROTATE_CCW, label)) {
      notifyInfo('Rasterize this text layer to rotate it.');
    }
    return;
  }
  if (!layer || layer.type !== 'raster') return;

  state.pushHistory(label);
  const texture = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  const content = readContentRect(engine, activeId) ?? { x: 0, y: 0, width: layer.width, height: layer.height };
  rotateLayer90(engine, activeId, direction === 'cw');

  const origin = rotatedTextureOrigin(texture, content, direction);
  const newLayers = state.document.layers.map((l) =>
    l.id === activeId && l.type === 'raster'
      ? { ...l, x: origin.x, y: origin.y, width: l.height, height: l.width } as Layer
      : l,
  );

  pixelDataManager.remove(activeId);
  const dirtyIds = new Set(state.dirtyLayerIds);
  dirtyIds.add(activeId);
  useEditorStore.setState({
    document: { ...state.document, layers: newLayers },
    dirtyLayerIds: dirtyIds,
    renderVersion: state.renderVersion + 1,
  });
}

/**
 * Turn a live text layer with the canvas: the quarter turn joins its
 * transform and its anchor moves to where the rotated canvas puts it, then
 * the glyphs are re-rendered — the text stays editable.
 */
function rotateTextLayerWithCanvas(
  engine: Engine,
  layer: TextLayer,
  direction: 'cw' | 'ccw',
  docWidth: number,
  docHeight: number,
): Layer {
  if (layer.pathId) return layer;
  const frame = measureTextFrame(engine, layer);
  if (!frame) return layer;
  // CW maps (x, y) → (H − y, x); CCW maps (x, y) → (y, W − x).
  const turn = direction === 'cw' ? ROTATE_CW : ROTATE_CCW;
  const shift = direction === 'cw' ? { x: docHeight, y: 0 } : { x: 0, y: docWidth };
  const turned = applyDocumentLinear(frame, turn, { x: 0, y: 0 });
  const anchor = { x: turned.anchor.x + shift.x, y: turned.anchor.y + shift.y };
  const next: TextLayer = { ...layer, transform: textTransformFor(turned.matrix, anchor, layer.x, layer.y) };
  const pos = placeTextLayerAtAnchor(engine, next, anchor.x, anchor.y);
  if (!pos) return layer;
  pixelDataManager.remove(layer.id);
  return { ...next, ...placementProps(pos) };
}

export function rotateImage(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const doc = state.document;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory(direction === 'cw' ? 'Rotate Image 90° CW' : 'Rotate Image 90° CCW');

  const newWidth = doc.height;
  const newHeight = doc.width;
  const newLayers: Layer[] = [];

  const textLayerIds: string[] = [];
  for (const layer of doc.layers) {
    if (layer.type === 'text') {
      const turned = rotateTextLayerWithCanvas(engine, layer, direction, doc.width, doc.height);
      if (turned !== layer) textLayerIds.push(layer.id);
      newLayers.push(turned);
      continue;
    }
    if (layer.type !== 'raster') {
      newLayers.push(layer);
      continue;
    }

    // GPU-side rotate
    rotateLayer90(engine, layer.id, direction === 'cw');

    // Rotate layer position around document center
    let newX: number;
    let newY: number;
    if (direction === 'cw') {
      newX = doc.height - layer.y - layer.height;
      newY = layer.x;
    } else {
      newX = layer.y;
      newY = doc.width - layer.x - layer.width;
    }

    newLayers.push({
      ...layer,
      x: newX,
      y: newY,
      width: layer.height,
      height: layer.width,
    } as Layer);
  }

  // Update document size on the engine
  setDocumentSize(engine, newWidth, newHeight);

  // GPU-side rotate invalidates every layer's JS cache. clearAll() is a
  // one-shot (see its call sites in history-slice.ts) and would go silent
  // on a second consecutive rotate — use invalidateLayers() instead (#918).
  pixelDataManager.invalidateLayers(newLayers.map((l) => l.id));
  useEditorStore.setState({
    dirtyLayerIds: new Set([...useEditorStore.getState().dirtyLayerIds, ...textLayerIds]),
    document: {
      ...doc,
      width: newWidth,
      height: newHeight,
      layers: newLayers,
    },
    renderVersion: state.renderVersion + 1,
  });
}

function getActiveGroupId(): string | null {
  const state = useEditorStore.getState();
  const doc = state.document;
  const activeId = doc.activeLayerId;
  if (activeId) {
    const active = doc.layers.find((l) => l.id === activeId);
    if (active?.type === 'group') return active.id;
  }
  return doc.rootGroupId ?? null;
}

function getActiveLayerPixels(): Uint8ClampedArray | null {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return null;
  const imageData = readLayerAsImageData(activeId);
  return imageData?.data ?? null;
}

function addAdjustmentAndCommit(node: AdjustmentNode, label: string): void {
  const groupId = getActiveGroupId();
  if (!groupId) return;

  const state = useEditorStore.getState();
  state.pushHistory(label);

  const doc = useEditorStore.getState().document;
  const group = doc.layers.find((l) => l.id === groupId) as GroupLayer | undefined;
  if (!group || group.type !== 'group') return;

  const layers = doc.layers.map((l) => {
    if (l.id !== groupId || l.type !== 'group') return l;
    const updated = { ...l, adjustments: [...l.adjustments, node] } as GroupLayer;
    if (updated.blendMode === 'pass-through') {
      return { ...updated, blendMode: 'normal' } as Layer;
    }
    return updated as Layer;
  });
  useEditorStore.setState({ document: { ...doc, layers } });
  state.notifyRender();
}

export function applyAutoTone(): void {
  const pixels = getActiveLayerPixels();
  if (!pixels) return;

  const levels = computeAutoTone(pixels);
  const node: AdjustmentNode = {
    id: crypto.randomUUID(),
    enabled: true,
    type: 'levels',
    levels,
  };
  addAdjustmentAndCommit(node, 'Auto Tone');
}

export function applyAutoContrast(): void {
  const pixels = getActiveLayerPixels();
  if (!pixels) return;

  const levels = computeAutoContrast(pixels);
  const node: AdjustmentNode = {
    id: crypto.randomUUID(),
    enabled: true,
    type: 'levels',
    levels,
  };
  addAdjustmentAndCommit(node, 'Auto Contrast');
}

export function applyAutoColor(): void {
  const pixels = getActiveLayerPixels();
  if (!pixels) return;

  const curves = computeAutoColor(pixels);
  const node: AdjustmentNode = {
    id: crypto.randomUUID(),
    enabled: true,
    type: 'curves',
    curves,
  };
  addAdjustmentAndCommit(node, 'Auto Color');
}

export type ImageDialogId = 'canvas-size' | 'image-size' | 'convert-to-indexed';

const MODE_MENU_ITEMS: readonly { mode: DocumentColorMode; label: string }[] = [
  { mode: 'rgb', label: 'RGB Color' },
  { mode: 'grayscale', label: 'Grayscale' },
  { mode: 'indexed', label: 'Indexed Color' },
  { mode: 'cmyk', label: 'CMYK Color' },
  { mode: 'lab', label: 'Lab Color' },
];

function createModeSubmenu(
  colorMode: DocumentColorMode,
  convertColorMode: (mode: DocumentColorMode) => void,
  showDialog: (id: ImageDialogId) => void,
): MenuItem[] {
  return MODE_MENU_ITEMS.map(({ mode, label }) => ({
    // Indexed needs palette size and dithering up front, so it opens a dialog
    // instead of converting on click.
    label: mode === 'indexed' ? `${label}...` : label,
    checked: colorMode === mode,
    action: mode === 'indexed'
      ? () => showDialog('convert-to-indexed')
      : () => convertColorMode(mode),
  }));
}

export function createImageMenu(
  showDialog: (id: ImageDialogId) => void,
  colorMode: DocumentColorMode,
  convertColorMode: (mode: DocumentColorMode) => void,
): MenuDef {
  return {
  label: 'Image',
  items: [
    { label: 'Mode', submenu: createModeSubmenu(colorMode, convertColorMode, showDialog) },
    { separator: true, label: '' },
    { label: 'Canvas Size...', action: () => showDialog('canvas-size') },
    { label: 'Image Size...', action: () => showDialog('image-size') },
    { separator: true, label: '' },
    { label: 'Auto Tone', shortcut: '\u21E7\u2318L', action: applyAutoTone },
    { label: 'Auto Contrast', shortcut: '\u2325\u21E7\u2318L', action: applyAutoContrast },
    { label: 'Auto Color', shortcut: '\u21E7\u2318B', action: applyAutoColor },
    { separator: true, label: '' },
    { label: 'Rotate 90\u00B0 CW', action: () => rotateImage('cw') },
    { label: 'Rotate 90\u00B0 CCW', action: () => rotateImage('ccw') },
    { label: 'Flip Horizontal', action: () => flipActiveLayer('horizontal') },
    { label: 'Flip Vertical', action: () => flipActiveLayer('vertical') },
  ],
  };
}
