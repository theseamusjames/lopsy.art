import { useCallback, useEffect } from 'react';
import { Focus } from 'lucide-react';
import { useUIStore } from '../../ui-store';
import { applyTiltShift, cancelTiltShift, previewTiltShift } from '../../MenuBar/tilt-shift-actions';
import styles from './TiltShiftControls.module.css';

function stopPropagation(e: React.PointerEvent | React.MouseEvent): void {
  e.stopPropagation();
}

export function TiltShiftControls() {
  const session = useUIStore((s) => s.tiltShift);
  const updateTiltShift = useUIStore((s) => s.updateTiltShift);

  const handleFocusPositionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateTiltShift({ focusPosition: Number(e.target.value) / 100 });
    previewTiltShift();
  }, [updateTiltShift]);

  const handleFocusWidthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateTiltShift({ focusWidth: Number(e.target.value) / 100 });
    previewTiltShift();
  }, [updateTiltShift]);

  const handleBlurChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateTiltShift({ blurRadius: Number(e.target.value) });
    previewTiltShift();
  }, [updateTiltShift]);

  useEffect(() => {
    if (!session) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyTiltShift();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelTiltShift();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [session]);

  if (!session) return null;

  return (
    <div
      className={styles.panel}
      role="dialog"
      aria-label="Tilt-Shift Blur"
      onPointerDown={stopPropagation}
      onMouseDown={stopPropagation}
      onMouseUp={stopPropagation}
      onMouseMove={stopPropagation}
    >
      <div className={styles.header}>
        <Focus size={14} aria-hidden="true" />
        <span>Tilt-Shift Blur</span>
      </div>
      <div className={styles.body}>
        <label className={styles.row}>
          <span className={styles.label}>Focus Position</span>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={100}
            step={1}
            value={Math.round(session.focusPosition * 100)}
            onChange={handleFocusPositionChange}
            aria-label="Focus position"
          />
          <span className={styles.value}>{Math.round(session.focusPosition * 100)}%</span>
        </label>
        <label className={styles.row}>
          <span className={styles.label}>Focus Width</span>
          <input
            type="range"
            className={styles.slider}
            min={1}
            max={100}
            step={1}
            value={Math.round(session.focusWidth * 100)}
            onChange={handleFocusWidthChange}
            aria-label="Focus width"
          />
          <span className={styles.value}>{Math.round(session.focusWidth * 100)}%</span>
        </label>
        <label className={styles.row}>
          <span className={styles.label}>Blur Radius</span>
          <input
            type="range"
            className={styles.slider}
            min={1}
            max={32}
            step={1}
            value={session.blurRadius}
            onChange={handleBlurChange}
            aria-label="Blur radius"
          />
          <span className={styles.value}>{session.blurRadius}px</span>
        </label>
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.cancelButton} onClick={cancelTiltShift}>
          Cancel
        </button>
        <button type="button" className={styles.applyButton} onClick={applyTiltShift}>
          Apply
        </button>
      </div>
    </div>
  );
}
