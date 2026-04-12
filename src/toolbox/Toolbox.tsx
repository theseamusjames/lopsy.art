import {
  Move,
  Lasso,
  Wand2,
  Paintbrush,
  Pen,
  Eraser,
  PaintBucket,
  Pipette,
  Stamp,
  Sun,
  Type,
  Pentagon,
  Crop,
  PenTool,
} from 'lucide-react';
import { IconButton } from '../components/IconButton/IconButton';
import { useUIStore } from '../app/ui-store';
import type { ToolId } from '../types';
import styles from './Toolbox.module.css';

const ICON_SIZE = 16;

function MarqueeRectIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 3" />
    </svg>
  );
}

function MarqueeEllipseIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="12" rx="9" ry="9" strokeDasharray="4 3" />
    </svg>
  );
}

function MagneticLassoIcon({ size }: { size: number }) {
  // Lasso loop with a horseshoe magnet overlapping it from above — the
  // magnet's poles dip into the top of the loop so the two shapes read as
  // one combined icon at 16 px instead of floating apart.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="13" cy="13" rx="6" ry="5" />
      <path d="M18 17 C 20 19, 21 21, 21 22" />
      <path d="M10 11 L10 4 A3 2 0 0 1 16 4 L16 11" />
      <path d="M8 11 L12 11" />
      <path d="M14 11 L18 11" />
    </svg>
  );
}

function GradientIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad-icon" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="url(#grad-icon)" />
    </svg>
  );
}

interface ToolDef {
  id: ToolId;
  icon: React.ReactNode;
  label: string;
}

const toolGroups: ToolDef[][] = [
  [
    { id: 'move', icon: <Move size={ICON_SIZE} />, label: 'Move (V)' },
  ],
  [
    { id: 'marquee-rect', icon: <MarqueeRectIcon size={ICON_SIZE} />, label: 'Rectangular Marquee (M)' },
    { id: 'marquee-ellipse', icon: <MarqueeEllipseIcon size={ICON_SIZE} />, label: 'Elliptical Marquee' },
    { id: 'lasso', icon: <Lasso size={ICON_SIZE} />, label: 'Lasso (L)' },
    { id: 'lasso-magnetic', icon: <MagneticLassoIcon size={ICON_SIZE} />, label: 'Magnetic Lasso' },
    { id: 'wand', icon: <Wand2 size={ICON_SIZE} />, label: 'Magic Wand (W)' },
  ],
  [
    { id: 'brush', icon: <Paintbrush size={ICON_SIZE} />, label: 'Brush (B)' },
    { id: 'pencil', icon: <Pen size={ICON_SIZE} />, label: 'Pencil (N)' },
    { id: 'eraser', icon: <Eraser size={ICON_SIZE} />, label: 'Eraser (E)' },
  ],
  [
    { id: 'fill', icon: <PaintBucket size={ICON_SIZE} />, label: 'Fill (G)' },
    { id: 'gradient', icon: <GradientIcon size={ICON_SIZE} />, label: 'Gradient' },
    { id: 'stamp', icon: <Stamp size={ICON_SIZE} />, label: 'Clone Stamp (S)' },
  ],
  [
    { id: 'dodge', icon: <Sun size={ICON_SIZE} />, label: 'Dodge/Burn (O)' },
    { id: 'eyedropper', icon: <Pipette size={ICON_SIZE} />, label: 'Eyedropper (I)' },
  ],
  [
    { id: 'shape', icon: <Pentagon size={ICON_SIZE} />, label: 'Shape (U)' },
    { id: 'text', icon: <Type size={ICON_SIZE} />, label: 'Text (T)' },
    { id: 'path', icon: <PenTool size={ICON_SIZE} />, label: 'Pen Tool (P)' },
  ],
  [
    { id: 'crop', icon: <Crop size={ICON_SIZE} />, label: 'Crop (C)' },
  ],
];

export function Toolbox() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);

  return (
    <div className={styles.toolbox}>
      <div className={styles.tools}>
        {toolGroups.map((group, gi) => (
          <div key={gi} className={styles.group}>
            {group.map((tool) => (
              <IconButton
                key={tool.id}
                icon={tool.icon}
                label={tool.label}
                isActive={activeTool === tool.id}
                onClick={() => setActiveTool(tool.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
