import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { PixelBuffer } from '../../engine/pixel-data';
import { createRectSelection, invertSelection } from '../../selection/selection';

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

export function flipActiveLayer(axis: 'horizontal' | 'vertical'): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;
  state.pushHistory();
  const imageData = state.getOrCreateLayerPixelData(activeId);
  const buf = PixelBuffer.fromImageData(imageData);
  const result = new PixelBuffer(buf.width, buf.height);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const sx = axis === 'horizontal' ? buf.width - 1 - x : x;
      const sy = axis === 'vertical' ? buf.height - 1 - y : y;
      result.setPixel(x, y, buf.getPixel(sx, sy));
    }
  }
  state.updateLayerPixelData(activeId, result.toImageData());
}

export function rotateActiveLayer(direction: 'cw' | 'ccw'): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;
  state.pushHistory();
  const imageData = state.getOrCreateLayerPixelData(activeId);
  const buf = PixelBuffer.fromImageData(imageData);
  const result = new PixelBuffer(buf.height, buf.width);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      if (direction === 'cw') {
        result.setPixel(buf.height - 1 - y, x, buf.getPixel(x, y));
      } else {
        result.setPixel(y, buf.width - 1 - x, buf.getPixel(x, y));
      }
    }
  }
  state.updateLayerPixelData(activeId, result.toImageData());
}

export function fillSelection(): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;
  state.pushHistory();
  const imageData = state.getOrCreateLayerPixelData(activeId);
  const buf = PixelBuffer.fromImageData(imageData);
  const color = useUIStore.getState().foregroundColor;
  const sel = state.selection;

  if (sel.active && sel.mask) {
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        if ((sel.mask[y * sel.maskWidth + x] ?? 0) > 0) {
          buf.setPixel(x, y, color);
        }
      }
    }
  } else {
    buf.fill(color);
  }
  state.updateLayerPixelData(activeId, buf.toImageData());
}

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

export function selectAll(): void {
  const state = useEditorStore.getState();
  const { width, height } = state.document;
  const rect = { x: 0, y: 0, width, height };
  const mask = createRectSelection(rect, width, height);
  state.setSelection(rect, mask, width, height);
}

export function invertSelectionAction(): void {
  const state = useEditorStore.getState();
  const sel = state.selection;
  if (!sel.active || !sel.mask) return;
  const inverted = invertSelection(sel.mask);
  const { width, height } = state.document;
  state.setSelection({ x: 0, y: 0, width, height }, inverted, sel.maskWidth, sel.maskHeight);
}
