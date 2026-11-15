import { Slider } from '../../../components/Slider/Slider';
import type { PhotoFilterNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function PhotoFilterControls({ node, onChange }: NodeControlProps<PhotoFilterNode>) {
  const toHex = (c: { r: number; g: number; b: number }) =>
    '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const fromHex = (hex: string): { r: number; g: number; b: number } => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });
  return (
    <div className={styles.sliders}>
      <div className={styles.colorRow}>
        <label className={styles.colorLabel}>Filter color</label>
        <input
          type="color"
          className={styles.colorSwatch}
          value={toHex(node.color)}
          onChange={(e) => onChange({ color: fromHex(e.target.value) })}
          aria-label="Filter color"
        />
      </div>
      <Slider label="Density" value={node.density} min={0} max={100} step={1} defaultValue={25}
        onChange={(v) => onChange({ density: v })} />
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={node.preserveLuminosity}
          onChange={(e) => onChange({ preserveLuminosity: e.target.checked })} />
        <span>Preserve Luminosity</span>
      </label>
    </div>
  );
}
