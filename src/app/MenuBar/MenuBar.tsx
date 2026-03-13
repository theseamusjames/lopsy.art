import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { addNoise, fillWithNoise } from '../../filters/noise';
import { FilterDialog } from '../../components/FilterDialog/FilterDialog';
import { NoiseDialog, FillNoiseDialog } from '../../components/FilterDialog/NoiseDialog';
import {
  exportCanvas,
  flipActiveLayer,
  rotateActiveLayer,
  fillSelection,
  openFileFromDisk,
  selectAll,
  invertSelectionAction,
} from './menu-actions';
import {
  type FilterDialogId,
  getActiveLayerBuffer,
  applyFilterResult,
  getFilterDialogConfig,
  applyGenericFilter,
  applyInvert,
  applyDesaturate,
} from './filter-actions';
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

function getMenus(showFilterDialog: (id: FilterDialogId) => void): MenuDef[] {
  return [
    {
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
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: '\u2318Z', action: () => useEditorStore.getState().undo() },
        { label: 'Redo', shortcut: '\u21E7\u2318Z', action: () => useEditorStore.getState().redo() },
        { separator: true, label: '' },
        { label: 'Cut', shortcut: '\u2318X', disabled: true },
        { label: 'Copy', shortcut: '\u2318C', disabled: true },
        { label: 'Paste', shortcut: '\u2318V', disabled: true },
        { separator: true, label: '' },
        { label: 'Fill', shortcut: '\u21E7F5', action: () => fillSelection() },
      ],
    },
    {
      label: 'Image',
      items: [
        { label: 'Canvas Size...', disabled: true },
        { label: 'Image Size...', disabled: true },
        { separator: true, label: '' },
        { label: 'Rotate 90\u00B0 CW', action: () => rotateActiveLayer('cw') },
        { label: 'Rotate 90\u00B0 CCW', action: () => rotateActiveLayer('ccw') },
        { label: 'Flip Horizontal', action: () => flipActiveLayer('horizontal') },
        { label: 'Flip Vertical', action: () => flipActiveLayer('vertical') },
      ],
    },
    {
      label: 'Layer',
      items: [
        { label: 'New Layer', shortcut: '\u21E7\u2318N', action: () => useEditorStore.getState().addLayer() },
        { label: 'Duplicate Layer', shortcut: '\u2318J', action: () => useEditorStore.getState().duplicateLayer() },
        { separator: true, label: '' },
        { label: 'Merge Down', shortcut: '\u2318E', action: () => useEditorStore.getState().mergeDown() },
        { label: 'Flatten Image', action: () => useEditorStore.getState().flattenImage() },
      ],
    },
    {
      label: 'Select',
      items: [
        { label: 'All', shortcut: '\u2318A', action: () => selectAll() },
        { label: 'Deselect', shortcut: '\u2318D', action: () => useEditorStore.getState().clearSelection() },
        { label: 'Inverse', shortcut: '\u21E7\u2318I', action: () => invertSelectionAction() },
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
          label: 'Zoom In', shortcut: '\u2318=',
          action: () => {
            const state = useEditorStore.getState();
            state.setZoom(Math.min(64, state.viewport.zoom * 1.5));
          },
        },
        {
          label: 'Zoom Out', shortcut: '\u2318-',
          action: () => {
            const state = useEditorStore.getState();
            state.setZoom(Math.max(0.01, state.viewport.zoom / 1.5));
          },
        },
        {
          label: 'Fit to Screen', shortcut: '\u23180',
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
          label: 'Actual Size', shortcut: '\u23181',
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
        { label: 'About Lopsy', disabled: true },
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
    void applyGenericFilter(activeDialog, values);
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
