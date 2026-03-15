import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import {
  CanvasAllocator,
  applyColorOverlay,
  renderOuterGlow,
  renderInnerGlow,
  renderDropShadow,
  renderStroke,
} from '../../../engine/effects-renderer';
import { renderLayerContent } from '../../rendering/render-layers';
import { addPngMetadata, addJpegComment } from '../../../utils/image-metadata';
import { hasActiveAdjustments, applyAdjustmentsToImageData } from '../../../filters/image-adjustments';
import type { MenuDef } from './types';

const METADATA_NOTE = 'Made with Lopsy — http://lopsy.art';

function confirmIfDirty(): boolean {
  if (!useEditorStore.getState().isDirty) return true;
  return window.confirm('You have unsaved changes. Are you sure you want to continue?');
}

export function openFileFromDisk(): void {
  if (!confirmIfDirty()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const name = file.name.replace(/\.[^.]+$/, '');
        useEditorStore.getState().openImageAsDocument(imageData, name);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  input.click();
}

export function exportCanvas(format: 'png' | 'jpeg'): void {
  const state = useEditorStore.getState();
  const { width, height, backgroundColor } = state.document;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Fill background
  ctx.fillStyle = `rgba(${backgroundColor.r},${backgroundColor.g},${backgroundColor.b},${backgroundColor.a})`;
  ctx.fillRect(0, 0, width, height);

  // Composite all visible layers
  const allocator = new CanvasAllocator();
  for (const layerId of state.document.layerOrder) {
    const layer = state.document.layers.find((l) => l.id === layerId);
    if (!layer || !layer.visible) continue;
    const data = state.layerPixelData.get(layerId);
    if (!data) continue;
    const { canvas: tempCanvas, ctx: tempCtx } = allocator.acquire(data.width, data.height);
    tempCtx.putImageData(data, 0, 0);

    if (layer.effects.colorOverlay.enabled) {
      const overlaid = tempCtx.getImageData(0, 0, data.width, data.height);
      applyColorOverlay(overlaid, layer);
      tempCtx.putImageData(overlaid, 0, 0);
    }

    ctx.globalAlpha = layer.opacity;
    renderOuterGlow(ctx, tempCanvas, layer, data, allocator);
    renderDropShadow(ctx, tempCanvas, layer, data, allocator);
    renderLayerContent(ctx, tempCanvas, layer, data, false, null, allocator);
    renderInnerGlow(ctx, tempCanvas, layer, data, allocator);
    renderStroke(ctx, tempCanvas, layer, data, allocator);
  }
  ctx.globalAlpha = 1;
  allocator.releaseAll();

  // Apply post-composite image adjustments
  const uiState = useUIStore.getState();
  if (uiState.adjustmentsEnabled && hasActiveAdjustments(uiState.adjustments)) {
    const imgData = ctx.getImageData(0, 0, width, height);
    applyAdjustmentsToImageData(imgData, uiState.adjustments);
    ctx.putImageData(imgData, 0, 0);
  }

  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const tagged =
      format === 'png'
        ? await addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE })
        : await addJpegComment(blob, METADATA_NOTE);
    const url = URL.createObjectURL(tagged);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lopsy.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    useEditorStore.getState().markClean();
  }, mimeType, 0.92);
}

export const fileMenu: MenuDef = {
  label: 'File',
  items: [
    { label: 'New', shortcut: '\u2318N', action: () => { if (confirmIfDirty()) useUIStore.getState().setShowNewDocumentModal(true); } },
    { label: 'Open...', shortcut: '\u2318O', action: () => openFileFromDisk() },
    { separator: true, label: '' },
    { label: 'Export PNG', shortcut: '\u21E7\u2318E', action: () => exportCanvas('png') },
    { label: 'Export JPEG', action: () => exportCanvas('jpeg') },
  ],
};
