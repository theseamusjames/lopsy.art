import type { ToolId } from '../../types';
import styles from './StatusBar.module.css';

interface StatusBarProps {
  zoom: number;
  cursorX: number;
  cursorY: number;
  docWidth: number;
  docHeight: number;
  activeTool: ToolId;
}

const TOOL_LABELS: Record<ToolId, string> = {
  'move': 'Move',
  'brush': 'Brush',
  'pencil': 'Pencil',
  'eraser': 'Eraser',
  'fill': 'Paint Bucket',
  'gradient': 'Gradient',
  'eyedropper': 'Eyedropper',
  'stamp': 'Clone Stamp',
  'dodge': 'Dodge/Burn',
  'burn': 'Dodge/Burn',
  'marquee-rect': 'Rectangular Marquee',
  'marquee-ellipse': 'Elliptical Marquee',
  'lasso': 'Lasso',
  'lasso-poly': 'Polygonal Lasso',
  'wand': 'Magic Wand',
  'shape': 'Shape',
  'text': 'Text',
  'crop': 'Crop',
  'path': 'Pen Tool',
};

export function StatusBar({ zoom, cursorX, cursorY, docWidth, docHeight, activeTool }: StatusBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.item}>{Math.round(zoom * 100)}%</span>
      <span className={styles.divider} />
      <span className={styles.item}>
        X: <span className={styles.number}>{cursorX}</span> Y:{' '}
        <span className={styles.number}>{cursorY}</span>
      </span>
      <span className={styles.divider} />
      <span className={styles.item}>
        <span className={styles.number}>{docWidth}</span> x{' '}
        <span className={styles.number}>{docHeight}</span> px
      </span>
      <span className={styles.spacer} />
      <span className={styles.toolName}>{TOOL_LABELS[activeTool] ?? activeTool}</span>
    </div>
  );
}
