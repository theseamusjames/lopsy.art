import { Slider } from '../../../components/Slider/Slider';
import type { VignetteNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function VignetteControls({ node, onChange }: NodeControlProps<VignetteNode>) {
  return (
    <div className={styles.sliders}>
      <Slider label="Vignette" value={node.vignette} min={0} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ vignette: v })} />
    </div>
  );
}
