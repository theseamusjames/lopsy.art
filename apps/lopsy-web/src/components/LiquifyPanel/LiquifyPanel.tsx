import { useCallback } from 'react';
import { useUIStore } from '../../app/ui-store';
import { applyLiquify, cancelLiquify } from '../../app/MenuBar/liquify-actions';
import type { LiquifyMode, LiquifySettings } from '../../tools/liquify/liquify';
import styles from './LiquifyPanel.module.css';

const MODES: Array<{ value: LiquifyMode; label: string }> = [
  { value: 'push', label: 'Push Forward' },
  { value: 'twirl-cw', label: 'Twirl CW' },
  { value: 'twirl-ccw', label: 'Twirl CCW' },
  { value: 'bloat', label: 'Bloat' },
  { value: 'pinch', label: 'Pinch' },
];

export function LiquifyPanel() {
  const session = useUIStore((s) => s.liquify);
  const updateSettings = useUIStore((s) => s.updateLiquifySettings);

  const handleModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!session) return;
      updateSettings({ ...session.settings, mode: e.target.value as LiquifyMode });
    },
    [session, updateSettings],
  );

  const handleBrushSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!session) return;
      updateSettings({ ...session.settings, brushSize: Number(e.target.value) });
    },
    [session, updateSettings],
  );

  const handlePressureChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!session) return;
      updateSettings({ ...session.settings, pressure: Number(e.target.value) / 100 });
    },
    [session, updateSettings],
  );

  const handleApply = useCallback(() => {
    applyLiquify();
  }, []);

  const handleCancel = useCallback(() => {
    cancelLiquify();
  }, []);

  if (!session) return null;

  const { settings } = session;

  return (
    <div className={styles.panel} data-testid="liquify-panel" role="dialog" aria-label="Liquify">
      <div className={styles.header}>
        <span className={styles.title}>Liquify</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="liquify-mode">Mode</label>
        <select
          id="liquify-mode"
          className={styles.select}
          value={settings.mode}
          onChange={handleModeChange}
          aria-label="Liquify mode"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="liquify-brush-size">
          Brush Size
          <span className={styles.value}>{settings.brushSize}</span>
        </label>
        <input
          id="liquify-brush-size"
          type="range"
          className={styles.slider}
          min={4}
          max={500}
          step={1}
          value={settings.brushSize}
          onChange={handleBrushSizeChange}
          aria-label="Brush size"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="liquify-pressure">
          Pressure
          <span className={styles.value}>{Math.round(settings.pressure * 100)}%</span>
        </label>
        <input
          id="liquify-pressure"
          type="range"
          className={styles.slider}
          min={1}
          max={100}
          step={1}
          value={Math.round(settings.pressure * 100)}
          onChange={handlePressureChange}
          aria-label="Brush pressure"
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={handleCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.applyButton}
          onClick={handleApply}
          data-testid="liquify-apply"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export type { LiquifySettings };
