import { Slider } from '../../../components/Slider/Slider';
import type { ContrastNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function ContrastControls({ node, onChange }: NodeControlProps<ContrastNode>) {
  return (
    <div className={styles.sliders}>
      <Slider label="Contrast" value={node.contrast} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ contrast: v })} />
    </div>
  );
}
