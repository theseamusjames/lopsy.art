import { Slider } from '../../../components/Slider/Slider';
import type { HighlightsShadowsNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function HighlightsShadowsControls({ node, onChange }: NodeControlProps<HighlightsShadowsNode>) {
  return (
    <div className={styles.sliders}>
      <Slider label="Highlights" value={node.highlights} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ highlights: v })} />
      <Slider label="Shadows" value={node.shadows} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ shadows: v })} />
      <Slider label="Whites" value={node.whites} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ whites: v })} />
      <Slider label="Blacks" value={node.blacks} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ blacks: v })} />
    </div>
  );
}
