import { Slider } from '../../components/Slider/Slider';
import type { StrokeEffect } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { docScaledMax } from '../../utils/slider-ranges';
import { EffectColorInput } from './EffectColorInput';
import styles from './LayerEffectsPanel.module.css';

interface StrokeFormProps {
  stroke: StrokeEffect;
  onChange: (s: StrokeEffect) => void;
  onColorEditStart?: () => void;
  onDragStart?: () => void;
}

export function StrokeForm({ stroke, onChange, onColorEditStart, onDragStart }: StrokeFormProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const widthMax = docScaledMax(docWidth, docHeight, 50);

  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <EffectColorInput
          color={stroke.color}
          ariaLabel="Stroke color"
          onChange={(color) => onChange({ ...stroke, color })}
          onEditStart={onColorEditStart}
        />
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          {/* #664 — text input accepts up to the document-scaled max;
              sliderMax pins the drag range to a usable ~100px so the
              knob resolution stays sane on large canvases. */}
          <Slider label="Width" value={stroke.width} min={1} max={widthMax} sliderMax={100} onChange={(v) => onChange({ ...stroke, width: v })} onDragStart={onDragStart} />
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Position</span>
        <div className={styles.positionGroup}>
          {(['outside', 'center', 'inside'] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              className={`${styles.positionBtn} ${stroke.position === pos ? styles.positionBtnActive : ''}`}
              onClick={() => onChange({ ...stroke, position: pos })}
              aria-pressed={stroke.position === pos}
              aria-label={`Stroke position: ${pos}`}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
