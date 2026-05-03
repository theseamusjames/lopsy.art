import { useCallback, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { PanelContainer } from '../PanelContainer/PanelContainer';
import { usePanelCollapse } from '../usePanelCollapse';
import { useSwatchesStore } from '../../app/store/swatches-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { rgbToHex6 } from '../../utils/color';
import { IconButton } from '../../components/IconButton/IconButton';
import styles from './SwatchesPanel.module.css';

interface ContextMenuState {
  swatchId: string;
  x: number;
  y: number;
}

export function SwatchesPanel() {
  const [collapsed, setCollapsed] = usePanelCollapse('swatches');
  const swatches = useSwatchesStore((s) => s.swatches);
  const addSwatch = useSwatchesStore((s) => s.addSwatch);
  const removeSwatch = useSwatchesStore((s) => s.removeSwatch);
  const renameSwatch = useSwatchesStore((s) => s.renameSwatch);
  const foregroundColor = useToolSettingsStore((s) => s.foregroundColor);
  const setForegroundColor = useToolSettingsStore((s) => s.setForegroundColor);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleSwatchClick = useCallback(
    (id: string) => {
      const swatch = swatches.find((s) => s.id === id);
      if (!swatch) return;
      setForegroundColor(swatch.color);
    },
    [swatches, setForegroundColor],
  );

  const handleSwatchContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      setContextMenu({ swatchId: id, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleAddSwatch = useCallback(() => {
    const hex = rgbToHex6(foregroundColor).slice(1).toUpperCase();
    addSwatch(foregroundColor, `#${hex}`);
  }, [foregroundColor, addSwatch]);

  const handleRenameStart = useCallback(
    (id: string) => {
      const swatch = swatches.find((s) => s.id === id);
      if (!swatch) return;
      setRenamingId(id);
      setRenameValue(swatch.name);
      setContextMenu(null);
      // Focus the input after render
      requestAnimationFrame(() => renameInputRef.current?.select());
    },
    [swatches],
  );

  const handleRenameCommit = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      renameSwatch(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, renameSwatch]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleRenameCommit();
      if (e.key === 'Escape') setRenamingId(null);
    },
    [handleRenameCommit],
  );

  const handleDelete = useCallback(
    (id: string) => {
      removeSwatch(id);
      setContextMenu(null);
    },
    [removeSwatch],
  );

  const handleOverlayClick = useCallback(() => setContextMenu(null), []);

  return (
    <PanelContainer
      title="Swatches"
      collapsed={collapsed}
      onToggle={() => setCollapsed((c) => !c)}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <IconButton
            icon={<Plus size={14} />}
            label="Add current foreground color as swatch"
            onClick={handleAddSwatch}
            size="sm"
            data-testid="add-swatch-btn"
          />
        </div>
        {!collapsed && (
          <>
            {swatches.length === 0 ? (
              <div className={styles.empty}>No swatches. Click + to add.</div>
            ) : (
              <div className={styles.grid} data-testid="swatches-grid">
                {swatches.map((swatch) => (
                  <div key={swatch.id} className={styles.swatchWrapper} title={swatch.name}>
                    {renamingId === swatch.id ? (
                      <input
                        ref={renameInputRef}
                        className={styles.renameInput}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleRenameCommit}
                        onKeyDown={handleRenameKeyDown}
                        aria-label="Rename swatch"
                        autoFocus
                      />
                    ) : (
                      <button
                        className={styles.swatch}
                        style={{ backgroundColor: `rgba(${swatch.color.r},${swatch.color.g},${swatch.color.b},${swatch.color.a})` }}
                        onClick={() => handleSwatchClick(swatch.id)}
                        onContextMenu={(e) => handleSwatchContextMenu(e, swatch.id)}
                        type="button"
                        aria-label={swatch.name}
                        data-swatch-id={swatch.id}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {contextMenu && (
        <>
          <div className={styles.contextOverlay} onClick={handleOverlayClick} />
          <div
            className={styles.contextMenu}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            data-testid="swatch-context-menu"
          >
            <button
              className={styles.contextItem}
              onClick={() => handleRenameStart(contextMenu.swatchId)}
              type="button"
            >
              Rename
            </button>
            <button
              className={styles.contextItem}
              onClick={() => handleDelete(contextMenu.swatchId)}
              type="button"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </PanelContainer>
  );
}
