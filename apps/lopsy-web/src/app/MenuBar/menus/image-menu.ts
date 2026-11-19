import { useEditorStore } from '../../editor-store';
import { getEngine } from '../../../engine-wasm/engine-state';
import { rotateLayer90 } from '../../../engine-wasm/wasm-bridge';
import { readLayerContentRectLocal } from '../../layer-content-rect';
import { pixelDataManager } from '../../../engine/pixel-data-manager';
import type { Layer, DocumentColorMode } from '../../../types';
import { transformTextLayerInDocument } from '../../text-layer-transform';
import { notifyInfo } from '../../notifications-store';
import { ROTATE_CCW, ROTATE_CW } from '../../../tools/text/text-transform';
import type { MenuDef, MenuItem } from './types';
import { rotatedTextureOrigin } from '../../../layers/rotate-90';
import { remapLayerMaskThrough } from '../../store/actions/_helpers/remap-layer-masks';
import { layerRotation90 } from '../../../layers/mask-remap';
import {
  applyAutoColor,
  applyAutoContrast,
  applyAutoTone,
  flipActiveLayer,
  rotateImage,
} from '../../image-actions';

export async function rotateActiveLayer(direction: 'cw' | 'ccw'): Promise<void> {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  const activeType = useEditorStore.getState().document.layers.find((l) => l.id === activeId)?.type;
  const measured = activeType === 'raster' ? await readLayerContentRectLocal(engine, activeId) : null;
  if (getEngine() !== engine) return;

  const state = useEditorStore.getState();
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
  const content = measured ?? { x: 0, y: 0, width: layer.width, height: layer.height };
  rotateLayer90(engine, activeId, direction === 'cw');

  const origin = rotatedTextureOrigin(texture, content, direction);
  const turn = layerRotation90(direction, texture, origin, texture.width, texture.height);
  const { width: docWidth, height: docHeight } = state.document;
  const newLayers = state.document.layers.map((l) => {
    if (l.id !== activeId || l.type !== 'raster') return l;
    const turned = { ...l, x: origin.x, y: origin.y, width: l.height, height: l.width } as Layer;
    return remapLayerMaskThrough(engine, l, turned, turn, docWidth, docHeight);
  });

  pixelDataManager.remove(activeId);
  const dirtyIds = new Set(state.dirtyLayerIds);
  dirtyIds.add(activeId);
  useEditorStore.setState({
    document: { ...state.document, layers: newLayers },
    dirtyLayerIds: dirtyIds,
    renderVersion: state.renderVersion + 1,
  });
}

export type ImageDialogId = 'canvas-size' | 'image-size' | 'border' | 'convert-to-indexed';

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
    { label: 'Border...', action: () => showDialog('border') },
    { separator: true, label: '' },
    { label: 'Auto Tone', shortcut: '\u21E7\u2318L', action: applyAutoTone },
    { label: 'Auto Contrast', shortcut: '\u2325\u21E7\u2318L', action: applyAutoContrast },
    { label: 'Auto Color', shortcut: '\u21E7\u2318B', action: applyAutoColor },
    { separator: true, label: '' },
    { label: 'Rotate 90\u00B0 CW', action: () => rotateImage('cw') },
    { label: 'Rotate 90\u00B0 CCW', action: () => rotateImage('ccw') },
    { label: 'Flip Horizontal', action: () => void flipActiveLayer('horizontal') },
    { label: 'Flip Vertical', action: () => void flipActiveLayer('vertical') },
  ],
  };
}
