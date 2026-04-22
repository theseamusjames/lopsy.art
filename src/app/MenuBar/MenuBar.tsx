import { useCallback, useEffect, useRef, useState } from 'react';
import { FilterDialog } from '../../components/FilterDialog/FilterDialog';
import { NoiseDialog, FillNoiseDialog } from '../../components/FilterDialog/NoiseDialog';
import { PatternFillDialog } from '../../components/PatternFillDialog/PatternFillDialog';
import {
  type FilterDialogId,
  getFilterDialogConfig,
  applyGenericFilter,
  applyAddNoise,
  applyFillWithNoise,
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
import { getMenus, type MenuItem, type ImageDialogId, type HelpDialogId } from './menus';
import { CanvasSizeModal } from '../../components/CanvasSizeModal/CanvasSizeModal';
import { ImageSizeModal } from '../../components/ImageSizeModal/ImageSizeModal';
import { KeyboardShortcutsModal } from '../../components/KeyboardShortcutsModal/KeyboardShortcutsModal';
import { AboutModal } from '../../components/AboutModal/AboutModal';
import styles from './MenuBar.module.css';

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [activeDialog, setActiveDialog] = useState<FilterDialogId | null>(null);
  const [imageDialog, setImageDialog] = useState<ImageDialogId | null>(null);
  const [helpDialog, setHelpDialog] = useState<HelpDialogId | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const previewActiveRef = useRef(false);

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

  const menus = getMenus(showFilterDialog, showImageDialog, showHelpDialog);

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

  const handleNoiseApply = useCallback((settings: { amount: number; type: 'gaussian' | 'uniform'; monochromatic: boolean }) => {
    applyAddNoise(settings.amount, settings.monochromatic);
    setActiveDialog(null);
  }, []);

  const handleFillNoiseApply = useCallback((settings: { type: 'gaussian' | 'uniform'; monochromatic: boolean }) => {
    applyFillWithNoise(settings.monochromatic);
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

  const filterDef = activeDialog && activeDialog !== 'add-noise' && activeDialog !== 'fill-noise' && activeDialog !== 'pattern-fill'
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
          onApply={handleGenericFilterApply}
          onCancel={handleDialogCancel}
          onPreviewStart={handlePreviewStart}
          onPreviewStop={handlePreviewStop}
          onPreviewChange={handlePreviewChange}
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
      {activeDialog === 'pattern-fill' && (
        <PatternFillDialog
          onApply={handlePatternFillApply}
          onCancel={handleDialogCancel}
          onPreviewStart={handlePatternPreviewStart}
          onPreviewStop={handlePatternPreviewStop}
          onPreviewChange={handlePatternPreviewChange}
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
    </>
  );
}
