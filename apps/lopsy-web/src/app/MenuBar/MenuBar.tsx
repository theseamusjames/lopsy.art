import { useCallback, useEffect, useRef, useState } from 'react';
import { FilterDialog } from '../../components/FilterDialog/FilterDialog';
import { useEscapeDismiss } from '../shortcuts/escape-dismiss';
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
import type { PatternFillSettings } from '../pattern-store';
import {
  exportCanvasWithOptions,
  createExportPreviewSession,
  registerOpenExportDialog,
  unregisterOpenExportDialog,
} from './menus/file-menu';
import type { ExportOptions } from './export-logic';
import { getMenus, type MenuItem, type ImageDialogId, type HelpDialogId, type SelectDialogId } from './menus';
import { CanvasSizeModal } from '../../components/CanvasSizeModal/CanvasSizeModal';
import { ImageSizeModal } from '../../components/ImageSizeModal/ImageSizeModal';
import { BorderModal } from '../../components/BorderModal/BorderModal';
import { IndexedColorModal } from '../../components/IndexedColorModal/IndexedColorModal';
import { KeyboardShortcutsModal } from '../../components/KeyboardShortcutsModal/KeyboardShortcutsModal';
import { AboutModal } from '../../components/AboutModal/AboutModal';
import { useEditorStore } from '../editor-store';
import {
  EMPTY_MODIFIED_SELECTION,
  modifySelection,
  SELECTION_MODIFY_LABELS,
  type SelectionModifyOutcome,
} from '../selection-actions';
import { announceRefusal } from '../../commands/refusal';
import { invokeFromUi } from '../../commands/invoke-from-ui';
import { registerDialogOpener, unregisterDialogOpener } from './dialog-openers';
import { BrandLinks } from '../../components/BrandLinks/BrandLinks';
import styles from './MenuBar.module.css';

function announceEmptyModify(outcome: SelectionModifyOutcome): void {
  if (outcome === 'empty') announceRefusal(EMPTY_MODIFIED_SELECTION);
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const [submenuPos, setSubmenuPos] = useState({ x: 0, y: 0 });
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

  // The ui.dialog.* commands open these dialogs through the registered openers.
  useEffect(() => {
    registerDialogOpener('filter', showFilterDialog);
    registerDialogOpener('image', showImageDialog);
    registerDialogOpener('help', showHelpDialog);
    registerDialogOpener('select', showSelectDialog);
    return () => {
      unregisterDialogOpener('filter');
      unregisterDialogOpener('image');
      unregisterDialogOpener('help');
      unregisterDialogOpener('select');
    };
  }, [showFilterDialog, showImageDialog, showHelpDialog, showSelectDialog]);

  // A colour-mode change re-renders the bar, so Image > Mode's checkmark follows it.
  useEditorStore((s) => s.document.colorMode);

  const menus = getMenus();

  const handleMenuClick = useCallback((index: number) => {
    setOpenSubmenu(null);
    setOpenMenu((prev) => (prev === index ? null : index));
  }, []);

  const handleMenuEnter = useCallback(
    (index: number) => {
      if (openMenu !== null) {
        setOpenSubmenu(null);
        setOpenMenu(index);
      }
    },
    [openMenu],
  );

  // Dropdowns scroll (the Filter menu is far taller than a short viewport),
  // and a scroll container clips absolutely-positioned descendants at its
  // padding box. Position the flyout against the viewport instead, measuring
  // the parent row so it still lines up with the item that opened it.
  const handleSubmenuEnter = useCallback((index: number, parent: HTMLElement) => {
    const rect = parent.getBoundingClientRect();
    setSubmenuPos({ x: rect.right, y: rect.top });
    setOpenSubmenu(index);
  }, []);

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item.disabled || (!item.action && !item.command)) return;
    if (item.command) invokeFromUi(item.command.id, item.command.params);
    else item.action?.();
    setOpenSubmenu(null);
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

  // Escape closes an open menu and does nothing else, so pressing it to
  // dismiss a menu no longer also drops the selection (#1188).
  const closeMenu = useCallback(() => {
    setOpenSubmenu(null);
    setOpenMenu(null);
  }, []);
  useEscapeDismiss(openMenu !== null, closeMenu);

  const handlePatternFillApply = useCallback((patternId: string, settings: PatternFillSettings) => {
    if (previewActiveRef.current) {
      applyPatternFillWithPreview(patternId, settings);
      previewActiveRef.current = false;
    } else {
      applyPatternFill(patternId, settings);
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

  const handlePatternPreviewChange = useCallback((patternId: string, settings: PatternFillSettings) => {
    if (!previewActiveRef.current) return;
    previewPatternFill(patternId, settings);
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

  const handleExportPreviewSource = useCallback(() => {
    return createExportPreviewSession();
  }, []);

  const handleSelectDialogApply = useCallback((values: Record<string, number>) => {
    if (!selectDialog) return;
    const amount = values['amount'] ?? 1;
    const close = (): void => setSelectDialog(null);
    const outcome = modifySelection(selectDialog, amount);
    if (outcome instanceof Promise) {
      void outcome.then(announceEmptyModify).finally(close);
      return;
    }
    announceEmptyModify(outcome);
    close();
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
                  ) : item.submenu ? (
                    <div
                      key={j}
                      className={styles.submenuParent}
                      onMouseEnter={(e) => handleSubmenuEnter(j, e.currentTarget)}
                      onMouseLeave={() => setOpenSubmenu(null)}
                    >
                      <button
                        className={`${styles.dropdownItem} ${item.disabled ? styles.dropdownItemDisabled : ''}`}
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={openSubmenu === j}
                        aria-disabled={item.disabled}
                      >
                        <span>{item.label}</span>
                        <span className={styles.submenuArrow} aria-hidden="true">{'\u203a'}</span>
                      </button>
                      {openSubmenu === j && (
                        <div
                          className={styles.submenu}
                          role="menu"
                          aria-label={item.label}
                          style={{ '--submenu-x': `${submenuPos.x}px`, '--submenu-y': `${submenuPos.y}px` } as React.CSSProperties}
                        >
                          {item.submenu.map((sub, k) => (
                            <button
                              key={k}
                              className={`${styles.dropdownItem} ${sub.disabled ? styles.dropdownItemDisabled : ''}`}
                              onClick={() => handleItemClick(sub)}
                              type="button"
                              role="menuitem"
                              aria-disabled={sub.disabled}
                            >
                              <span>
                                {sub.checked !== undefined && (
                                  <span className={styles.checkmark} aria-hidden="true">{sub.checked ? '\u2713' : ''}</span>
                                )}
                                {sub.label}
                              </span>
                              {sub.shortcut && <span className={styles.shortcut} aria-hidden="true">{sub.shortcut}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
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
        <div className={styles.brand}>
          <BrandLinks />
        </div>
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
      {imageDialog === 'border' && (
        <BorderModal onClose={() => setImageDialog(null)} />
      )}
      {imageDialog === 'convert-to-indexed' && (
        <IndexedColorModal onClose={() => setImageDialog(null)} />
      )}
      {helpDialog === 'keyboard-shortcuts' && (
        <KeyboardShortcutsModal onClose={() => setHelpDialog(null)} />
      )}
      {helpDialog === 'about' && (
        <AboutModal onClose={() => setHelpDialog(null)} />
      )}
      {selectDialog && (
        <FilterDialog
          title={SELECTION_MODIFY_LABELS[selectDialog]}
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
          onPreviewSourceRequest={handleExportPreviewSource}
        />
      )}
    </>
  );
}
