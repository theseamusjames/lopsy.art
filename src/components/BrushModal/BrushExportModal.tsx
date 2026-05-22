import { useState, useCallback } from 'react';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { BrushThumbnail } from './BrushThumbnail';
import { exportPresets } from '../../tools/brush/preset-io';
import styles from './BrushExportModal.module.css';

interface BrushExportModalProps {
  onClose: () => void;
}

export function BrushExportModal({ onClose }: BrushExportModalProps) {
  const presets = useToolSettingsStore((s) => s.presets);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(presets.map((p) => p.id)));

  const togglePreset = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(presets.map((p) => p.id)));
  }, [presets]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleExport = useCallback(() => {
    if (selected.size > 0) {
      exportPresets(presets.filter((p) => selected.has(p.id)));
      onClose();
    }
  }, [selected, onClose]);

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal} role="dialog" aria-label="Export Brushes">
        <div className={styles.titleBar}>
          <span className={styles.titleText}>Export Brushes</span>
          <button className={styles.closeX} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className={styles.body}>
          <div className={styles.gallery}>
            {presets.map((preset) => (
              <button
                key={preset.id}
                className={`${styles.item}${selected.has(preset.id) ? ` ${styles.itemSelected}` : ''}`}
                onClick={() => togglePreset(preset.id)}
                title={preset.name}
              >
                <BrushThumbnail preset={preset} size={36} />
                <span className={styles.itemName}>{preset.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <button className={styles.smallButton} onClick={selectAll}>Select All</button>
            <button className={styles.smallButton} onClick={selectNone}>Select None</button>
            <span className={styles.count}>{selected.size} selected</span>
          </div>
          <button className={styles.exportButton} onClick={handleExport} disabled={selected.size === 0}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
