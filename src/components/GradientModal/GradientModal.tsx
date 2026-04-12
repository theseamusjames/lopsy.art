import { useCallback, useState } from 'react';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { GradientEditor } from '../GradientEditor/GradientEditor';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import type { GradientStop } from '../../tools/gradient/gradient';
import type { Color } from '../../types';
import styles from './GradientModal.module.css';

interface GradientModalProps {
  onClose: () => void;
}

export function GradientModal({ onClose }: GradientModalProps) {
  const gradientStops = useToolSettingsStore((s) => s.gradientStops);
  const setGradientStops = useToolSettingsStore((s) => s.setGradientStops);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const sorted = [...gradientStops].sort((a, b) => a.position - b.position);
  const selectedStop = sorted[selectedIndex];

  const handleStopsChange = useCallback((stops: readonly GradientStop[]) => {
    setGradientStops(stops);
  }, [setGradientStops]);

  const handleSelectStop = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleColorChange = useCallback((color: Color) => {
    const newStops = sorted.map((stop, i) =>
      i === selectedIndex ? { ...stop, color } : stop,
    );
    setGradientStops(newStops);
  }, [sorted, selectedIndex, setGradientStops]);

  const handleDelete = useCallback(() => {
    if (gradientStops.length <= 2) return;
    const newStops = sorted.filter((_, i) => i !== selectedIndex);
    setGradientStops(newStops);
    setSelectedIndex(Math.min(selectedIndex, newStops.length - 1));
  }, [gradientStops.length, sorted, selectedIndex, setGradientStops]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Gradient Editor</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.editorSection}>
            <span className={styles.sectionLabel}>
              Click bar to add stops. Drag handles to reposition.
            </span>
            <GradientEditor
              stops={sorted}
              selectedIndex={selectedIndex}
              onStopsChange={handleStopsChange}
              onSelectStop={handleSelectStop}
            />
          </div>

          <div className={styles.stopInfo}>
            {selectedStop && (
              <>
                <div
                  className={styles.stopColorPreview}
                  style={{ backgroundColor: `rgb(${selectedStop.color.r},${selectedStop.color.g},${selectedStop.color.b})` }}
                />
                <span>Stop {selectedIndex + 1} of {sorted.length}</span>
                <span>Position: {Math.round(selectedStop.position * 100)}%</span>
                <button
                  className={styles.deleteBtn}
                  onClick={handleDelete}
                  disabled={gradientStops.length <= 2}
                  data-testid="gradient-delete-stop"
                >
                  Delete
                </button>
              </>
            )}
          </div>

          {selectedStop && (
            <div className={styles.pickerSection}>
              <ColorPicker color={selectedStop.color} onChange={handleColorChange} />
            </div>
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.closeButton} onClick={onClose} type="button">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
