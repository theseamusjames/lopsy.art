import { Slider } from '../../components/Slider/Slider';
import type { ShadowEffect } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { docScaledMax, docScaledOffset } from '../../utils/slider-ranges';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface DropShadowFormProps {
  shadow: ShadowEffect;
  onChange: (s: ShadowEffect) => void;
  onDragStart?: () => void;
}

export function DropShadowForm({ shadow, onChange, onDragStart }: DropShadowFormProps) {
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const offsetAbs = docScaledOffset(docWidth, docHeight, 100);
  const blurMax = docScaledMax(docWidth, docHeight, 100);
  const spreadMax = docScaledMax(docWidth, docHeight, 100);

  return (
    <>
      <div className={styles.row}>
        <span className={styles.fieldLabel}>Color</span>
        <label className={styles.colorSwatch} style={{ '--swatch-color': `rgb(${shadow.color.r}, ${shadow.color.g}, ${shadow.color.b})` } as React.CSSProperties}>
          <input
            type="color"
            className={styles.colorInput}
            value={colorToHex(shadow.color)}
            aria-label="Shadow color"
            onChange={(e) => onChange({ ...shadow, color: hexToColor(e.target.value, shadow.color.a) })}
          />
        </label>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          {/* #664: `max` accepts wide document-scaled input via the text
              field, but the drag range is pinned to a usable ±200px so
              on a 5000px canvas a slider drag isn't hunting one-pixel
              precision across the whole width. */}
          <Slider label="Offset X" value={shadow.offsetX} min={-offsetAbs} max={offsetAbs} sliderMin={-200} sliderMax={200} onChange={(v) => onChange({ ...shadow, offsetX: v })} onDragStart={onDragStart} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Offset Y" value={shadow.offsetY} min={-offsetAbs} max={offsetAbs} sliderMin={-200} sliderMax={200} onChange={(v) => onChange({ ...shadow, offsetY: v })} onDragStart={onDragStart} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Blur" value={shadow.blur} min={0} max={blurMax} sliderMax={200} onChange={(v) => onChange({ ...shadow, blur: v })} onDragStart={onDragStart} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider label="Spread" value={shadow.spread} min={0} max={spreadMax} sliderMax={200} onChange={(v) => onChange({ ...shadow, spread: v })} onDragStart={onDragStart} />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.sliderWrap}>
          <Slider
            label="Opacity"
            value={Math.round((shadow.opacity ?? 0.75) * 100)}
            min={0}
            max={100}
            onChange={(v) => onChange({ ...shadow, opacity: v / 100 })}
            onDragStart={onDragStart}
          />
        </div>
      </div>
    </>
  );
}
