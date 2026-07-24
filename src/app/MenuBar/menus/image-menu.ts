import { useEditorStore } from '../../editor-store';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  flipLayer,
  rotateLayer90,
  setDocumentSize,
} from '../../../engine-wasm/wasm-bridge';
import { readLayerAsImageData } from '../../../engine-wasm/gpu-pixel-access';
import { pixelDataManager } from '../../../engine/pixel-data-manager';
import { computeAutoTone, computeAutoContrast, computeAutoColor } from '../../../filters/auto-enhance';
import type { Layer, GroupLayer, DocumentColorMode } from '../../../types';
import type { AdjustmentNode } from '../../../types/adjustment-nodes';
import type { MenuDef, MenuItem } from './types';

export function flipActiveLayer(axis: 'horizontal' | 'vertical'): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory(axis === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical');
  flipLayer(engine, activeId, axis === 'horizontal');

  // GPU is now source of truth — clear stale JS pixel data.
  pixelDataManager.remove(activeId);
  const dirtyIds = new Set(state.dirtyLayerIds);
  dirtyIds.add(activeId);
  useEditorStore.setState({ dirtyLayerIds: dirtyIds });
  state.notifyRender();
}

export function rotateActiveLayer(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  const layer = state.document.layers.find((l) => l.id === activeId);
  if (!layer || layer.type !== 'raster') return;

  state.pushHistory(direction === 'cw' ? 'Rotate Layer 90° CW' : 'Rotate Layer 90° CCW');
  rotateLayer90(engine, activeId, direction === 'cw');

  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const newLayers = state.document.layers.map((l) =>
    l.id === activeId && l.type === 'raster'
      ? { ...l, x: cx - l.height / 2, y: cy - l.width / 2, width: l.height, height: l.width } as Layer
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

export function rotateImage(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const doc = state.document;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory(direction === 'cw' ? 'Rotate Image 90° CW' : 'Rotate Image 90° CCW');

  const newWidth = doc.height;
  const newHeight = doc.width;
  const newLayers: Layer[] = [];

  for (const layer of doc.layers) {
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

  // GPU-side rotate invalidates every layer's JS cache.
  pixelDataManager.clearAll();
  useEditorStore.setState({
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
