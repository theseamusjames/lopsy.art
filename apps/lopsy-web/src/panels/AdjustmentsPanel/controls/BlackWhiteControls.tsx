import { Slider } from '../../../components/Slider/Slider';
import type { BlackWhiteNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function BlackWhiteControls({ node, onChange }: NodeControlProps<BlackWhiteNode>) {
  return (
    <div className={styles.sliders}>
      <Slider label="Reds" value={node.reds} min={-200} max={300} step={1} defaultValue={40}
        onChange={(v) => onChange({ reds: v })} />
      <Slider label="Yellows" value={node.yellows} min={-200} max={300} step={1} defaultValue={60}
        onChange={(v) => onChange({ yellows: v })} />
      <Slider label="Greens" value={node.greens} min={-200} max={300} step={1} defaultValue={40}
        onChange={(v) => onChange({ greens: v })} />
      <Slider label="Cyans" value={node.cyans} min={-200} max={300} step={1} defaultValue={60}
        onChange={(v) => onChange({ cyans: v })} />
      <Slider label="Blues" value={node.blues} min={-200} max={300} step={1} defaultValue={20}
        onChange={(v) => onChange({ blues: v })} />
      <Slider label="Magentas" value={node.magentas} min={-200} max={300} step={1} defaultValue={80}
        onChange={(v) => onChange({ magentas: v })} />
    </div>
  );
}
