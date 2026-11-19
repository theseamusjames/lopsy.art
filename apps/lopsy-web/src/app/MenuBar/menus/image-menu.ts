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
import { commandItem } from './command-item';
import { rotatedTextureOrigin } from '../../../layers/rotate-90';
import { remapLayerMaskThrough } from '../../store/actions/_helpers/remap-layer-masks';
import { layerRotation90 } from '../../../layers/mask-remap';

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

function createModeSubmenu(): MenuItem[] {
  // Indexed needs palette size and dithering up front, so its item opens a
  // dialog instead of converting on click.
  return MODE_MENU_ITEMS.map(({ mode, label }) =>
    mode === 'indexed'
      ? commandItem(`${label}...`, 'ui.image.indexed-color')
      : commandItem(label, 'doc.color-mode', { mode }),
  );
}

export function createImageMenu(): MenuDef {
  return {
  label: 'Image',
  items: [
    { label: 'Mode', submenu: createModeSubmenu() },
    { separator: true, label: '' },
    commandItem('Canvas Size...', 'ui.dialog.image', { dialog: 'canvas-size' }),
    commandItem('Image Size...', 'ui.dialog.image', { dialog: 'image-size' }),
    commandItem('Border...', 'ui.dialog.image', { dialog: 'border' }),
    { separator: true, label: '' },
    commandItem('Auto Tone', 'image.auto', { kind: 'tone' }, '\u21E7\u2318L'),
    commandItem('Auto Contrast', 'image.auto', { kind: 'contrast' }, '\u2325\u21E7\u2318L'),
    commandItem('Auto Color', 'image.auto', { kind: 'color' }, '\u21E7\u2318B'),
    { separator: true, label: '' },
    commandItem('Rotate 90\u00B0 CW', 'image.rotate', { direction: 'cw' }),
    commandItem('Rotate 90\u00B0 CCW', 'image.rotate', { direction: 'ccw' }),
    commandItem('Flip Horizontal', 'image.flip-layer', { axis: 'horizontal' }),
    commandItem('Flip Vertical', 'image.flip-layer', { axis: 'vertical' }),
  ],
  };
}
