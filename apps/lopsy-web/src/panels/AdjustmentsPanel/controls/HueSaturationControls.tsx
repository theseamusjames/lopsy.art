import { Slider } from '../../../components/Slider/Slider';
import type { HueSaturationNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function HueSaturationControls({ node, onChange }: NodeControlProps<HueSaturationNode>) {
  return (
    <div className={styles.sliders}>
      <Slider label="Hue" value={node.hue} min={-180} max={180} step={1} defaultValue={0}
        onChange={(v) => onChange({ hue: v })} />
      <Slider label="Saturation" value={node.saturation} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ saturation: v })} />
      <Slider label="Lightness" value={node.lightness} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ lightness: v })} />
    </div>
  );
}
