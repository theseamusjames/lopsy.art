import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import type { MenuDef } from './types';

export function openFileFromDisk(): void {
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

  ctx.fillStyle = `rgba(${backgroundColor.r},${backgroundColor.g},${backgroundColor.b},${backgroundColor.a})`;
  ctx.fillRect(0, 0, width, height);

  for (const layerId of state.document.layerOrder) {
    const layer = state.document.layers.find((l) => l.id === layerId);
    if (!layer || !layer.visible) continue;
    const data = state.layerPixelData.get(layerId);
    if (!data) continue;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = data.width;
    tempCanvas.height = data.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) continue;
    tempCtx.putImageData(data, 0, 0);
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(tempCanvas, layer.x, layer.y);
    ctx.globalAlpha = 1;
  }

  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.document.name}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, mimeType, 0.92);
}

export const fileMenu: MenuDef = {
  label: 'File',
  items: [
    { label: 'New', shortcut: '\u2318N', action: () => useUIStore.getState().setShowNewDocumentModal(true) },
    { label: 'Open...', shortcut: '\u2318O', action: () => openFileFromDisk() },
    { separator: true, label: '' },
    { label: 'Save', shortcut: '\u2318S', disabled: true },
    { label: 'Save As...', shortcut: '\u21E7\u2318S', disabled: true },
    { separator: true, label: '' },
    { label: 'Export PNG', shortcut: '\u21E7\u2318E', action: () => exportCanvas('png') },
    { label: 'Export JPEG', action: () => exportCanvas('jpeg') },
  ],
};
