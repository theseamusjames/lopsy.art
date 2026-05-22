import { Slider } from '../../../components/Slider/Slider';
import type { ExposureNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function ExposureControls({ node, onChange }: NodeControlProps<ExposureNode>) {
  return (
    <div className={styles.sliders}>
      <Slider label="Exposure" value={node.exposure} min={-5} max={5} step={0.1} defaultValue={0}
        onChange={(v) => onChange({ exposure: v })} />
    </div>
  );
}
