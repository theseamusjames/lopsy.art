import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { createRectSelection, invertSelection } from '../../selection/selection';
import { PixelBuffer } from '../../engine/pixel-data';
import { gaussianBlur, boxBlur } from '../../filters/blur';
import { unsharpMask } from '../../filters/sharpen';
import { addNoise, fillWithNoise } from '../../filters/noise';
import {
  brightnessContrast,
  hueSaturation,
  invert,
  desaturate,
  posterize,
  threshold,
} from '../../filters/adjustments';
import { FilterDialog } from '../../components/FilterDialog/FilterDialog';
import type { FilterParam } from '../../components/FilterDialog/FilterDialog';
import { NoiseDialog, FillNoiseDialog } from '../../components/FilterDialog/NoiseDialog';
import styles from './MenuBar.module.css';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

type FilterDialogId =
  | 'gaussian-blur'
  | 'box-blur'
  | 'unsharp-mask'
  | 'add-noise'
  | 'fill-noise'
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'posterize'
  | 'threshold';

function getActiveLayerBuffer(): { buf: PixelBuffer; activeId: string } | null {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return null;
  const imageData = state.getOrCreateLayerPixelData(activeId);
  const buf = PixelBuffer.fromImageData(imageData);
  return { buf, activeId };
}

function applyFilterResult(activeId: string, result: PixelBuffer): void {
  const state = useEditorStore.getState();
  const sel = state.selection;

  if (sel.active && sel.mask) {
    // Only apply filter to selected region, blending with original
    const imageData = state.getOrCreateLayerPixelData(activeId);
    const original = PixelBuffer.fromImageData(imageData);
    const blended = original.clone();
    const { width, height } = original;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const maskValue = (sel.mask[y * sel.maskWidth + x] ?? 0) / 255;
        if (maskValue <= 0) continue;

        const origPixel = original.getPixel(x, y);
        const filtPixel = result.getPixel(x, y);

        if (maskValue >= 1) {
          blended.setPixel(x, y, filtPixel);
        } else {
          blended.setPixel(x, y, {
            r: Math.round(origPixel.r + (filtPixel.r - origPixel.r) * maskValue),
            g: Math.round(origPixel.g + (filtPixel.g - origPixel.g) * maskValue),
            b: Math.round(origPixel.b + (filtPixel.b - origPixel.b) * maskValue),
            a: origPixel.a + (filtPixel.a - origPixel.a) * maskValue,
          });
        }
      }
    }

    state.updateLayerPixelData(activeId, blended.toImageData());
  } else {
    state.updateLayerPixelData(activeId, result.toImageData());
  }
}

function exportCanvas(format: 'png' | 'jpeg') {
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

  // Composite layers bottom to top
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

function flipActiveLayer(axis: 'horizontal' | 'vertical') {
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

function rotateActiveLayer(direction: 'cw' | 'ccw') {
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

function fillSelection() {
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

function openFileFromDisk(): void {
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

function getFilterDialogConfig(id: FilterDialogId): { title: string; params: FilterParam[] } | null {
  switch (id) {
    case 'gaussian-blur':
      return {
        title: 'Gaussian Blur',
        params: [{ key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 5 }],
      };
    case 'box-blur':
      return {
        title: 'Box Blur',
        params: [{ key: 'radius', label: 'Radius', min: 1, max: 100, step: 1, defaultValue: 5 }],
      };
    case 'unsharp-mask':
      return {
        title: 'Unsharp Mask',
        params: [
          { key: 'radius', label: 'Radius', min: 1, max: 50, step: 1, defaultValue: 3 },
          { key: 'amount', label: 'Amount', min: 0.1, max: 5, step: 0.1, defaultValue: 1 },
          { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 0 },
        ],
      };
    case 'brightness-contrast':
      return {
        title: 'Brightness/Contrast',
        params: [
          { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, defaultValue: 0 },
          { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0 },
        ],
      };
    case 'hue-saturation':
      return {
        title: 'Hue/Saturation',
        params: [
          { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, defaultValue: 0 },
          { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, defaultValue: 0 },
          { key: 'lightness', label: 'Lightness', min: -100, max: 100, step: 1, defaultValue: 0 },
        ],
      };
    case 'posterize':
      return {
        title: 'Posterize',
        params: [{ key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, defaultValue: 4 }],
      };
    case 'threshold':
      return {
        title: 'Threshold',
        params: [{ key: 'level', label: 'Level', min: 0, max: 255, step: 1, defaultValue: 128 }],
      };
    default:
      return null;
  }
}

function applyGenericFilter(id: FilterDialogId, values: Record<string, number>): void {
  const layerData = getActiveLayerBuffer();
  if (!layerData) return;
  const { buf, activeId } = layerData;

  useEditorStore.getState().pushHistory();

  let result: PixelBuffer;
  switch (id) {
    case 'gaussian-blur':
      result = gaussianBlur(buf, values['radius'] ?? 5);
      break;
    case 'box-blur':
      result = boxBlur(buf, values['radius'] ?? 5);
      break;
    case 'unsharp-mask':
      result = unsharpMask(buf, values['radius'] ?? 3, values['amount'] ?? 1, values['threshold'] ?? 0);
      break;
    case 'brightness-contrast':
      result = brightnessContrast(buf, values['brightness'] ?? 0, values['contrast'] ?? 0);
      break;
    case 'hue-saturation':
      result = hueSaturation(buf, values['hue'] ?? 0, values['saturation'] ?? 0, values['lightness'] ?? 0);
      break;
    case 'posterize':
      result = posterize(buf, values['levels'] ?? 4);
      break;
    case 'threshold':
      result = threshold(buf, values['level'] ?? 128);
      break;
    default:
      return;
  }

  applyFilterResult(activeId, result);
}

function applyInvert(): void {
  const layerData = getActiveLayerBuffer();
  if (!layerData) return;
  const { buf, activeId } = layerData;
  useEditorStore.getState().pushHistory();
  const result = invert(buf);
  applyFilterResult(activeId, result);
}

function applyDesaturate(): void {
  const layerData = getActiveLayerBuffer();
  if (!layerData) return;
  const { buf, activeId } = layerData;
  useEditorStore.getState().pushHistory();
  const result = desaturate(buf);
  applyFilterResult(activeId, result);
}

function getMenus(showFilterDialog: (id: FilterDialogId) => void): MenuDef[] {
  return [
    {
      label: 'File',
      items: [
        {
          label: 'New',
          shortcut: '\u2318N',
          action: () => {
            useUIStore.getState().setShowNewDocumentModal(true);
          },
        },
        {
          label: 'Open...',
          shortcut: '\u2318O',
          action: () => openFileFromDisk(),
        },
        { separator: true, label: '' },
        { label: 'Save', shortcut: '\u2318S', disabled: true },
        { label: 'Save As...', shortcut: '\u21E7\u2318S', disabled: true },
        { separator: true, label: '' },
        {
          label: 'Export PNG',
          shortcut: '\u21E7\u2318E',
          action: () => exportCanvas('png'),
        },
        {
          label: 'Export JPEG',
          action: () => exportCanvas('jpeg'),
        },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          shortcut: '\u2318Z',
          action: () => useEditorStore.getState().undo(),
        },
        {
          label: 'Redo',
          shortcut: '\u21E7\u2318Z',
          action: () => useEditorStore.getState().redo(),
        },
        { separator: true, label: '' },
        { label: 'Cut', shortcut: '\u2318X', disabled: true },
        { label: 'Copy', shortcut: '\u2318C', disabled: true },
        { label: 'Paste', shortcut: '\u2318V', disabled: true },
        { separator: true, label: '' },
        {
          label: 'Fill',
          shortcut: '\u21E7F5',
          action: () => fillSelection(),
        },
      ],
    },
    {
      label: 'Image',
      items: [
        { label: 'Canvas Size...', disabled: true },
        { label: 'Image Size...', disabled: true },
        { separator: true, label: '' },
        {
          label: 'Rotate 90\u00B0 CW',
          action: () => rotateActiveLayer('cw'),
        },
        {
          label: 'Rotate 90\u00B0 CCW',
          action: () => rotateActiveLayer('ccw'),
        },
        {
          label: 'Flip Horizontal',
          action: () => flipActiveLayer('horizontal'),
        },
        {
          label: 'Flip Vertical',
          action: () => flipActiveLayer('vertical'),
        },
      ],
    },
    {
      label: 'Layer',
      items: [
        {
          label: 'New Layer',
          shortcut: '\u21E7\u2318N',
          action: () => useEditorStore.getState().addLayer(),
        },
        {
          label: 'Duplicate Layer',
          shortcut: '\u2318J',
          action: () => useEditorStore.getState().duplicateLayer(),
        },
        { separator: true, label: '' },
        {
          label: 'Merge Down',
          shortcut: '\u2318E',
          action: () => useEditorStore.getState().mergeDown(),
        },
        {
          label: 'Flatten Image',
          action: () => useEditorStore.getState().flattenImage(),
        },
      ],
    },
    {
      label: 'Select',
      items: [
        {
          label: 'All',
          shortcut: '\u2318A',
          action: () => {
            const state = useEditorStore.getState();
            const { width, height } = state.document;
            const rect = { x: 0, y: 0, width, height };
            const mask = createRectSelection(rect, width, height);
            state.setSelection(rect, mask, width, height);
          },
        },
        {
          label: 'Deselect',
          shortcut: '\u2318D',
          action: () => useEditorStore.getState().clearSelection(),
        },
        {
          label: 'Inverse',
          shortcut: '\u21E7\u2318I',
          action: () => {
            const state = useEditorStore.getState();
            const sel = state.selection;
            if (!sel.active || !sel.mask) return;
            const inverted = invertSelection(sel.mask);
            const { width, height } = state.document;
            state.setSelection({ x: 0, y: 0, width, height }, inverted, sel.maskWidth, sel.maskHeight);
          },
        },
      ],
    },
    {
      label: 'Filter',
      items: [
        { label: 'Gaussian Blur...', action: () => showFilterDialog('gaussian-blur') },
        { label: 'Box Blur...', action: () => showFilterDialog('box-blur') },
        { label: 'Unsharp Mask...', action: () => showFilterDialog('unsharp-mask') },
        { separator: true, label: '' },
        { label: 'Add Noise...', action: () => showFilterDialog('add-noise') },
        { label: 'Fill with Noise...', action: () => showFilterDialog('fill-noise') },
        { separator: true, label: '' },
        { label: 'Brightness/Contrast...', action: () => showFilterDialog('brightness-contrast') },
        { label: 'Hue/Saturation...', action: () => showFilterDialog('hue-saturation') },
        { separator: true, label: '' },
        { label: 'Invert', action: () => applyInvert() },
        { label: 'Desaturate', action: () => applyDesaturate() },
        { label: 'Posterize...', action: () => showFilterDialog('posterize') },
        { label: 'Threshold...', action: () => showFilterDialog('threshold') },
      ],
    },
    {
      label: 'View',
      items: [
        {
          label: 'Zoom In',
          shortcut: '\u2318=',
          action: () => {
            const state = useEditorStore.getState();
            state.setZoom(Math.min(64, state.viewport.zoom * 1.5));
          },
        },
        {
          label: 'Zoom Out',
          shortcut: '\u2318-',
          action: () => {
            const state = useEditorStore.getState();
            state.setZoom(Math.max(0.01, state.viewport.zoom / 1.5));
          },
        },
        {
          label: 'Fit to Screen',
          shortcut: '\u23180',
          action: () => {
            const state = useEditorStore.getState();
            const { width, height } = state.document;
            const vp = state.viewport;
            if (vp.width > 0 && vp.height > 0) {
              state.setZoom(Math.min(vp.width / width, vp.height / height) * 0.9);
              state.setPan(0, 0);
            }
          },
        },
        {
          label: 'Actual Size',
          shortcut: '\u23181',
          action: () => {
            useEditorStore.getState().setZoom(1);
            useEditorStore.getState().setPan(0, 0);
          },
        },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', disabled: true },
        { label: 'About Loppsy', disabled: true },
      ],
    },
  ];
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [activeDialog, setActiveDialog] = useState<FilterDialogId | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const showFilterDialog = useCallback((id: FilterDialogId) => {
    setOpenMenu(null);
    setActiveDialog(id);
  }, []);

  const menus = getMenus(showFilterDialog);

  const handleMenuClick = useCallback((index: number) => {
    setOpenMenu((prev) => (prev === index ? null : index));
  }, []);

  const handleMenuEnter = useCallback(
    (index: number) => {
      if (openMenu !== null) {
        setOpenMenu(index);
      }
    },
    [openMenu],
  );

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item.disabled || !item.action) return;
    item.action();
    setOpenMenu(null);
  }, []);

  const handleDialogCancel = useCallback(() => {
    setActiveDialog(null);
  }, []);

  const handleGenericFilterApply = useCallback((values: Record<string, number>) => {
    if (!activeDialog) return;
    applyGenericFilter(activeDialog, values);
    setActiveDialog(null);
  }, [activeDialog]);

  const handleNoiseApply = useCallback((settings: { amount: number; type: 'gaussian' | 'uniform'; monochromatic: boolean }) => {
    const layerData = getActiveLayerBuffer();
    if (!layerData) return;
    const { buf, activeId } = layerData;
    useEditorStore.getState().pushHistory();
    const result = addNoise(buf, settings.amount, settings.type, settings.monochromatic);
    applyFilterResult(activeId, result);
    setActiveDialog(null);
  }, []);

  const handleFillNoiseApply = useCallback((settings: { type: 'gaussian' | 'uniform'; monochromatic: boolean }) => {
    const layerData = getActiveLayerBuffer();
    if (!layerData) return;
    const { buf, activeId } = layerData;
    useEditorStore.getState().pushHistory();
    const result = fillWithNoise(buf, settings.type, settings.monochromatic);
    applyFilterResult(activeId, result);
    setActiveDialog(null);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (openMenu === null) return;

    const handleClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [openMenu]);

  const dialogConfig = activeDialog && activeDialog !== 'add-noise' && activeDialog !== 'fill-noise'
    ? getFilterDialogConfig(activeDialog)
    : null;

  return (
    <>
      <div ref={barRef} className={styles.bar}>
        {menus.map((menu, i) => (
          <div key={menu.label} className={styles.menuItem}>
            <button
              className={`${styles.menuButton} ${openMenu === i ? styles.menuButtonActive : ''}`}
              onClick={() => handleMenuClick(i)}
              onMouseEnter={() => handleMenuEnter(i)}
              type="button"
            >
              {menu.label}
            </button>
            {openMenu === i && (
              <div className={styles.dropdown}>
                {menu.items.map((item, j) =>
                  item.separator ? (
                    <div key={j} className={styles.separator} />
                  ) : (
                    <button
                      key={j}
                      className={`${styles.dropdownItem} ${item.disabled ? styles.dropdownItemDisabled : ''}`}
                      onClick={() => handleItemClick(item)}
                      type="button"
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {dialogConfig && (
        <FilterDialog
          title={dialogConfig.title}
          params={dialogConfig.params}
          onApply={handleGenericFilterApply}
          onCancel={handleDialogCancel}
        />
      )}
      {activeDialog === 'add-noise' && (
        <NoiseDialog
          title="Add Noise"
          onApply={handleNoiseApply}
          onCancel={handleDialogCancel}
        />
      )}
      {activeDialog === 'fill-noise' && (
        <FillNoiseDialog
          title="Fill with Noise"
          onApply={handleFillNoiseApply}
          onCancel={handleDialogCancel}
        />
      )}
    </>
  );
}
