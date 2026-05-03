import { useCallback } from 'react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { applyBooleanOp } from '../../MenuBar/menus/path-menu';
import type { BooleanOp } from '../../../tools/path/boolean-ops';
import optStyles from '../OptionsBar.module.css';
import styles from './PathOptions.module.css';

export function PathOptions() {
  const pathStrokeWidth = useToolSettingsStore((s) => s.pathStrokeWidth);
  const setPathStrokeWidth = useToolSettingsStore((s) => s.setPathStrokeWidth);
  const paths = useEditorStore((s) => s.paths);
  const selectedPathId = useEditorStore((s) => s.selectedPathId);

  // Boolean ops need exactly 2 paths total with one selected
  const canDoBoolean = paths.length >= 2 && selectedPathId !== null;

  const handleOp = useCallback((op: BooleanOp) => {
    applyBooleanOp(op);
  }, []);

  return (
    <>
      <Slider label="Stroke" value={pathStrokeWidth} min={1} max={50} onChange={setPathStrokeWidth} />

      <div className={styles.separator} />

      <div className={styles.booleanGroup}>
        <BooleanButton
          op="union"
          label="Unite Paths"
          disabled={!canDoBoolean}
          onClick={handleOp}
        />
        <BooleanButton
          op="subtract"
          label="Subtract Paths"
          disabled={!canDoBoolean}
          onClick={handleOp}
        />
        <BooleanButton
          op="intersect"
          label="Intersect Paths"
          disabled={!canDoBoolean}
          onClick={handleOp}
        />
        <BooleanButton
          op="exclude"
          label="Exclude Paths"
          disabled={!canDoBoolean}
          onClick={handleOp}
        />
      </div>

      <span className={optStyles.hint}>Enter to stroke, Esc to cancel</span>
    </>
  );
}

interface BooleanButtonProps {
  op: BooleanOp;
  label: string;
  disabled: boolean;
  onClick: (op: BooleanOp) => void;
}

function BooleanButton({ op, label, disabled, onClick }: BooleanButtonProps) {
  const icon = BOOLEAN_ICONS[op];
  return (
    <button
      type="button"
      className={styles.booleanBtn}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onClick(op)}
      data-boolean-op={op}
    >
      {icon}
    </button>
  );
}

// SVG icons representing each boolean operation using simple shapes
const BOOLEAN_ICONS: Record<BooleanOp, React.ReactNode> = {
  union: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="7" y="7" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  subtract: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7" y="7" width="7" height="7" rx="1" fill="var(--color-bg-primary)" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  intersect: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="7" y="7" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="7" y="7" width="2" height="2" fill="currentColor" />
    </svg>
  ),
  exclude: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7" y="7" width="7" height="7" rx="1" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7" y="7" width="2" height="2" fill="var(--color-bg-primary)" />
    </svg>
  ),
};
