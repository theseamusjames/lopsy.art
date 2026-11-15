import { useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import { getMaxDocumentSide } from '../../engine-wasm/gpu-limits';
import {
  parseBorderWidth,
  planBorder,
  uniformBorderWidths,
  type BorderPlacement,
  type BorderPlan,
  type BorderWidths,
} from '../../layers/border';
import type { Color } from '../../types';
import styles from './BorderModal.module.css';

type BorderSides = 'symmetric' | 'asymmetric';
type Side = keyof BorderWidths;

const SIDES: readonly { key: Side; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
];

const DEFAULT_WIDTH = '20';

interface BorderModalProps {
  onClose: () => void;
}

export function BorderModal({ onClose }: BorderModalProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const isGrayscale = useEditorStore((s) => s.document.colorMode === 'grayscale');
  const addBorder = useEditorStore((s) => s.addBorder);

  const [color, setColor] = useState<Color>(() => useToolSettingsStore.getState().foregroundColor);
  const [sides, setSides] = useState<BorderSides>('symmetric');
  const [placement, setPlacement] = useState<BorderPlacement>('expand');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [sideWidths, setSideWidths] = useState<Record<Side, string>>({
    top: DEFAULT_WIDTH, bottom: DEFAULT_WIDTH, left: DEFAULT_WIDTH, right: DEFAULT_WIDTH,
  });

  const widths = useMemo<BorderWidths>(() => (sides === 'symmetric'
    ? uniformBorderWidths(parseBorderWidth(width))
    : {
      top: parseBorderWidth(sideWidths.top),
      right: parseBorderWidth(sideWidths.right),
      bottom: parseBorderWidth(sideWidths.bottom),
      left: parseBorderWidth(sideWidths.left),
    }), [sides, width, sideWidths]);
  const plan = planBorder(docWidth, docHeight, widths, placement, getMaxDocumentSide());

  const handleApply = useCallback(() => {
    if (!plan) return;
    addBorder(color, widths, placement);
    onClose();
  }, [plan, addBorder, color, widths, placement, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // The hex field claims Enter to commit its own edit.
    if (e.defaultPrevented) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [handleApply, onClose]);

  const handleSideWidthChange = useCallback((side: Side, value: string) => {
    setSideWidths((prev) => ({ ...prev, [side]: value }));
  }, []);

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Border" onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>Border</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.colorColumn}>
            <span className={styles.fieldLabel}>Color</span>
            <ColorPicker color={color} onChange={setColor} grayscale={isGrayscale} />
          </div>
          <div className={styles.settingsColumn}>
            <fieldset className={styles.group}>
              <legend className={styles.fieldLabel}>Width</legend>
              <div className={styles.radioRow}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="border-sides"
                    checked={sides === 'symmetric'}
                    onChange={() => setSides('symmetric')}
                  />
                  Symmetric
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="border-sides"
                    checked={sides === 'asymmetric'}
                    onChange={() => setSides('asymmetric')}
                  />
                  Asymmetric
                </label>
              </div>
              {sides === 'symmetric' ? (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Border width (px)</span>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    min="0"
                    step="1"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </label>
              ) : (
                <div className={styles.sideGrid}>
                  {SIDES.map(({ key, label }) => (
                    <label key={key} className={styles.field}>
                      <span className={styles.fieldLabel}>{label} (px)</span>
                      <input
                        className={styles.fieldInput}
                        type="number"
                        min="0"
                        step="1"
                        value={sideWidths[key]}
                        onChange={(e) => handleSideWidthChange(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <fieldset className={styles.group}>
              <legend className={styles.fieldLabel}>Placement</legend>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="border-placement"
                  checked={placement === 'expand'}
                  onChange={() => setPlacement('expand')}
                />
                Expand canvas
              </label>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="border-placement"
                  checked={placement === 'overlay'}
                  onChange={() => setPlacement('overlay')}
                />
                Overlay
              </label>
            </fieldset>
            <p className={styles.info} aria-live="polite">
              {describePlan(plan, widths, docWidth, docHeight)}
            </p>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>Cancel</button>
          <button className={styles.applyButton} onClick={handleApply} disabled={!plan}>Apply</button>
        </div>
      </div>
    </div>
  );
}

function describePlan(
  plan: BorderPlan | null,
  widths: BorderWidths,
  docWidth: number,
  docHeight: number,
): string {
  if (!plan) {
    const hasWidth = widths.top + widths.right + widths.bottom + widths.left > 0;
    return hasWidth
      ? `Too large: the canvas can be at most ${getMaxDocumentSide()} px on a side.`
      : 'Enter a border width.';
  }
  return plan.width === docWidth && plan.height === docHeight
    ? `Canvas stays ${docWidth} × ${docHeight} px`
    : `New size: ${plan.width} × ${plan.height} px`;
}
