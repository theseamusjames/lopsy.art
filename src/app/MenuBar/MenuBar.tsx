import { useCallback, useEffect, useRef, useState } from 'react';
import { FilterDialog } from '../../components/FilterDialog/FilterDialog';
import { PatternFillDialog } from '../../components/PatternFillDialog/PatternFillDialog';
import { ColorLutDialog } from '../../components/ColorLutDialog/ColorLutDialog';
import { ExportDialog } from '../../components/ExportDialog/ExportDialog';
import {
  type FilterDialogId,
  getFilterDialogConfig,
  applyGenericFilter,
  beginFilterPreview,
  previewGenericFilter,
  cancelFilterPreviewSession,
  applyGenericFilterWithPreview,
} from './filter-actions';
import {
  applyPatternFill,
  beginPatternPreview,
  previewPatternFill,
  cancelPatternPreview,
  applyPatternFillWithPreview,
} from './pattern-actions';
import {
  applyColorLut,
  applyColorLutDirect,
  beginColorLutPreview,
  previewColorLut,
  cancelColorLutPreview,
} from './color-lut-actions';
import type { LutPreset } from '../../filters/color-lut';
import {
  exportCanvasWithOptions,
  buildExportPreview,
  registerOpenExportDialog,
  unregisterOpenExportDialog,
} from './menus/file-menu';
import type { ExportOptions } from './export-logic';
import { getMenus, type MenuItem, type ImageDialogId, type HelpDialogId, type SelectDialogId } from './menus';
import { CanvasSizeModal } from '../../components/CanvasSizeModal/CanvasSizeModal';
import { ImageSizeModal } from '../../components/ImageSizeModal/ImageSizeModal';
import { KeyboardShortcutsModal } from '../../components/KeyboardShortcutsModal/KeyboardShortcutsModal';
import { AboutModal } from '../../components/AboutModal/AboutModal';
import { useEditorStore } from '../editor-store';
import { growSelection, shrinkSelection, selectionBounds } from '../../selection/selection';
import { getEngine } from '../../engine-wasm/engine-state';
import { setSelectionMask, featherSelectionMask, readSelectionMask } from '../../engine-wasm/wasm-bridge';
import { createTransformState } from '../../tools/transform/transform';
import { useUIStore } from '../ui-store';
import styles from './MenuBar.module.css';

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [activeDialog, setActiveDialog] = useState<FilterDialogId | null>(null);
  const [imageDialog, setImageDialog] = useState<ImageDialogId | null>(null);
  const [helpDialog, setHelpDialog] = useState<HelpDialogId | null>(null);
  const [selectDialog, setSelectDialog] = useState<SelectDialogId | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const previewActiveRef = useRef(false);

  // Register the export-dialog opener so file-menu can trigger it without
  // creating a circular dependency.
  useEffect(() => {
    registerOpenExportDialog(() => {
      setOpenMenu(null);
      setShowExportDialog(true);
    });
    return () => unregisterOpenExportDialog();
  }, []);

  const showFilterDialog = useCallback((id: FilterDialogId) => {
    setOpenMenu(null);
    setActiveDialog(id);
  }, []);

  const showImageDialog = useCallback((id: ImageDialogId) => {
    setOpenMenu(null);
    setImageDialog(id);
  }, []);

  const showHelpDialog = useCallback((id: HelpDialogId) => {
    setOpenMenu(null);
    setHelpDialog(id);
  }, []);

  const showSelectDialog = useCallback((id: SelectDialogId) => {
    setOpenMenu(null);
    setSelectDialog(id);
  }, []);

  const menus = getMenus(showFilterDialog, showImageDialog, showHelpDialog, showSelectDialog);

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
    if (previewActiveRef.current) {
      cancelFilterPreviewSession();
      previewActiveRef.current = false;
    }
    setActiveDialog(null);
  }, []);

  const handleGenericFilterApply = useCallback((values: Record<string, number>) => {
    if (!activeDialog) return;
    if (previewActiveRef.current) {
      applyGenericFilterWithPreview(activeDialog, values);
      previewActiveRef.current = false;
    } else {
      applyGenericFilter(activeDialog, values);
    }
    setActiveDialog(null);
  }, [activeDialog]);

  const handlePreviewStart = useCallback(() => {
    previewActiveRef.current = true;
    beginFilterPreview();
  }, []);

  const handlePreviewStop = useCallback(() => {
    if (previewActiveRef.current) {
      cancelFilterPreviewSession();
      previewActiveRef.current = false;
    }
  }, []);

  const handlePreviewChange = useCallback((values: Record<string, number>) => {
    if (!activeDialog || !previewActiveRef.current) return;
    previewGenericFilter(activeDialog, values);
  }, [activeDialog]);

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

  const handlePatternFillApply = useCallback((patternId: string, scale: number, offsetX: number, offsetY: number) => {
    if (previewActiveRef.current) {
      applyPatternFillWithPreview(patternId, scale, offsetX, offsetY);
      previewActiveRef.current = false;
    } else {
      applyPatternFill(patternId, scale, offsetX, offsetY);
    }
    setActiveDialog(null);
  }, []);

  const handlePatternPreviewStart = useCallback(() => {
    previewActiveRef.current = true;
    beginPatternPreview();
  }, []);

  const handlePatternPreviewStop = useCallback(() => {
    if (previewActiveRef.current) {
      cancelPatternPreview();
      previewActiveRef.current = false;
    }
  }, []);

  const handlePatternPreviewChange = useCallback((patternId: string, scale: number, offsetX: number, offsetY: number) => {
    if (!previewActiveRef.current) return;
    previewPatternFill(patternId, scale, offsetX, offsetY);
  }, []);

  const handleColorLutApply = useCallback((preset: LutPreset, intensity: number) => {
    if (previewActiveRef.current) {
      applyColorLut(preset, intensity);
      previewActiveRef.current = false;
    } else {
      applyColorLutDirect(preset, intensity);
    }
    setActiveDialog(null);
  }, []);

  const handleColorLutPreviewStart = useCallback(() => {
    previewActiveRef.current = true;
    beginColorLutPreview();
  }, []);

  const handleColorLutPreviewStop = useCallback(() => {
    if (previewActiveRef.current) {
      cancelColorLutPreview();
      previewActiveRef.current = false;
    }
  }, []);

  const handleColorLutPreviewChange = useCallback((preset: LutPreset, intensity: number) => {
    if (!previewActiveRef.current) return;
    previewColorLut(preset, intensity);
  }, []);

  const handleExportDialogExport = useCallback((options: ExportOptions) => {
    setShowExportDialog(false);
    exportCanvasWithOptions(options);
  }, []);

  const handleExportDialogCancel = useCallback(() => {
    setShowExportDialog(false);
  }, []);

  const handleExportDialogPreview = useCallback((options: ExportOptions) => {
    return buildExportPreview(options);
  }, []);

  const handleSelectDialogApply = useCallback((values: Record<string, number>) => {
    if (!selectDialog) return;
    const amount = values['amount'] ?? 1;
    const editor = useEditorStore.getState();
    const sel = editor.selection;
    if (!sel.active || !sel.mask) { setSelectDialog(null); return; }
    const { width: docW, height: docH } = editor.document;
    let newMask: Uint8ClampedArray;
    if (selectDialog === 'feather') {
      const engine = getEngine();
      if (engine) {
        const u8Mask = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
        setSelectionMask(engine, u8Mask, docW, docH);
        featherSelectionMask(engine, amount);
        const readback = readSelectionMask(engine);
        if (readback.length >= 8) {
          const dv = new DataView(readback.buffer, readback.byteOffset, readback.byteLength);
          const rw = dv.getUint32(0, true);
          const rh = dv.getUint32(4, true);
          newMask = new Uint8ClampedArray(readback.buffer, readback.byteOffset + 8, rw * rh);
        } else {
          newMask = sel.mask;
        }
      } else {
        newMask = sel.mask;
      }
    } else {
      newMask = selectDialog === 'grow'
        ? growSelection(sel.mask, docW, docH, amount)
        : shrinkSelection(sel.mask, docW, docH, amount);
    }
    const newBounds = selectionBounds(newMask, docW, docH);
    if (newBounds) {
      editor.setSelection(newBounds, newMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(newBounds));
    } else {
      editor.clearSelection();
      useUIStore.getState().setTransform(null);
    }
    setSelectDialog(null);
  }, [selectDialog]);

  const filterDef = activeDialog && activeDialog !== 'pattern-fill' && activeDialog !== 'color-lut'
    ? getFilterDialogConfig(activeDialog)
    : null;

  return (
    <>
      <nav ref={barRef} className={styles.bar} aria-label="Application menu">
        {menus.map((menu, i) => (
          <div key={menu.label} className={styles.menuItem}>
            <button
              className={`${styles.menuButton} ${openMenu === i ? styles.menuButtonActive : ''}`}
              onClick={() => handleMenuClick(i)}
              onMouseEnter={() => handleMenuEnter(i)}
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === i}
            >
              {menu.label}
            </button>
            {openMenu === i && (
              <div className={styles.dropdown} role="menu" aria-label={menu.label}>
                {menu.items.map((item, j) =>
                  item.separator ? (
                    <div key={j} className={styles.separator} role="separator" />
                  ) : (
                    <button
                      key={j}
                      className={`${styles.dropdownItem} ${item.disabled ? styles.dropdownItemDisabled : ''}`}
                      onClick={() => handleItemClick(item)}
                      type="button"
                      role="menuitem"
                      aria-disabled={item.disabled}
                    >
                      <span>
                        {item.checked !== undefined && (
                          <span className={styles.checkmark} aria-hidden="true">{item.checked ? '\u2713' : ''}</span>
                        )}
                        {item.label}
                      </span>
                      {item.shortcut && <span className={styles.shortcut} aria-hidden="true">{item.shortcut}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        <span className={styles.logo} aria-hidden="true">LOPSY</span>
      </nav>
      {filterDef && (
        <FilterDialog
          title={filterDef.title}
          params={filterDef.params}
          showRegenerate={filterDef.randomized}
          onApply={handleGenericFilterApply}
          onCancel={handleDialogCancel}
          onPreviewStart={handlePreviewStart}
          onPreviewStop={handlePreviewStop}
          onPreviewChange={handlePreviewChange}
        />
      )}
      {activeDialog === 'pattern-fill' && (
        <PatternFillDialog
          onApply={handlePatternFillApply}
          onCancel={handleDialogCancel}
          onPreviewStart={handlePatternPreviewStart}
          onPreviewStop={handlePatternPreviewStop}
          onPreviewChange={handlePatternPreviewChange}
        />
      )}
      {activeDialog === 'color-lut' && (
        <ColorLutDialog
          onApply={handleColorLutApply}
          onCancel={handleDialogCancel}
          onPreviewStart={handleColorLutPreviewStart}
          onPreviewStop={handleColorLutPreviewStop}
          onPreviewChange={handleColorLutPreviewChange}
        />
      )}
      {imageDialog === 'canvas-size' && (
        <CanvasSizeModal onClose={() => setImageDialog(null)} />
      )}
      {imageDialog === 'image-size' && (
        <ImageSizeModal onClose={() => setImageDialog(null)} />
      )}
      {helpDialog === 'keyboard-shortcuts' && (
        <KeyboardShortcutsModal onClose={() => setHelpDialog(null)} />
      )}
      {helpDialog === 'about' && (
        <AboutModal onClose={() => setHelpDialog(null)} />
      )}
      {selectDialog && (
        <FilterDialog
          title={
            selectDialog === 'grow' ? 'Grow Selection' :
            selectDialog === 'shrink' ? 'Shrink Selection' :
            'Feather Selection'
          }
          params={[{
            key: 'amount',
            label: selectDialog === 'feather' ? 'Radius (px)' : 'Amount (px)',
            min: 1,
            max: selectDialog === 'feather' ? 250 : 100,
            step: 1,
            defaultValue: 1,
          }]}
          onApply={handleSelectDialogApply}
          onCancel={() => setSelectDialog(null)}
        />
      )}
      {showExportDialog && (
        <ExportDialog
          onExport={handleExportDialogExport}
          onCancel={handleExportDialogCancel}
          onPreviewRequest={handleExportDialogPreview}
        />
      )}
    </>
  );
}
