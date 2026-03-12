import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { createRectSelection, invertSelection } from '../../selection/selection';
import { PixelBuffer } from '../../engine/pixel-data';
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

function getMenus(): MenuDef[] {
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
        { label: 'Blur...', disabled: true },
        { label: 'Sharpen...', disabled: true },
        { separator: true, label: '' },
        { label: 'Brightness/Contrast...', disabled: true },
        { label: 'Hue/Saturation...', disabled: true },
        { label: 'Levels...', disabled: true },
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
  const barRef = useRef<HTMLDivElement>(null);
  const menus = getMenus();

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

  return (
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
  );
}
