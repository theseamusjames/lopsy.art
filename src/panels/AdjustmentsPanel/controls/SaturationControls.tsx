import { Slider } from '../../../components/Slider/Slider';
import type { SaturationNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function SaturationControls({ node, onChange }: NodeControlProps<SaturationNode>) {
  return (
    <div className={styles.sliders}>
      <Slider label="Saturation" value={node.saturation} min={-100} max={200} step={1} defaultValue={0}
        onChange={(v) => onChange({ saturation: v })} />
      <Slider label="Vibrance" value={node.vibrance} min={-100} max={200} step={1} defaultValue={0}
        onChange={(v) => onChange({ vibrance: v })} />
    </div>
  );
}
