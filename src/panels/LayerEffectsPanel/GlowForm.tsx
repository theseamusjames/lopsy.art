import { Slider } from '../../components/Slider/Slider';
import type { GlowEffect } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { docScaledMax } from '../../utils/slider-ranges';
import { EffectColorInput } from './EffectColorInput';
import styles from './LayerEffectsPanel.module.css';

interface GlowFormProps {
  glow: GlowEffect;
  onChange: (g: GlowEffect) => void;
  onColorEditStart?: () => void;
  onDragStart?: () => void;
}

export function GlowForm({ glow, onChange, onColorEditStart, onDragStart }: GlowFormProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 100);
  const spreadMax = docScaledMax(docWidth, docHeight, 100);

  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <EffectColorInput
          color={glow.color}
          ariaLabel="Glow color"
          onChange={(color) => onChange({ ...glow, color })}
          onEditStart={onColorEditStart}
        />
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          {/* #664 — sliderMax caps the drag range at ~200px so precise
              tuning on large canvases stays practical; the text input
              accepts the full document-scaled max. */}
          <Slider label="Size" value={glow.size} min={0} max={sizeMax} sliderMax={200} onChange={(v) => onChange({ ...glow, size: v })} onDragStart={onDragStart} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Spread" value={glow.spread} min={0} max={spreadMax} sliderMax={200} onChange={(v) => onChange({ ...glow, spread: v })} onDragStart={onDragStart} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider
            label="Opacity"
            value={Math.round(glow.opacity * 100)}
            min={0}
            max={100}
            onChange={(v) => onChange({ ...glow, opacity: v / 100 })}
            onDragStart={onDragStart}
          />
        </div>
      </div>
    </>
  );
}
