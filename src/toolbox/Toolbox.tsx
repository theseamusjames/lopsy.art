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
  GalleryVerticalEnd,
} from 'lucide-react';
import { IconButton } from '../components/IconButton/IconButton';
import { ColorSwatch } from '../components/ColorSwatch/ColorSwatch';
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
    { id: 'wand', icon: <Wand2 size={ICON_SIZE} />, label: 'Magic Wand (W)' },
  ],
  [
    { id: 'brush', icon: <Paintbrush size={ICON_SIZE} />, label: 'Brush (B)' },
    { id: 'pencil', icon: <Pen size={ICON_SIZE} />, label: 'Pencil (N)' },
    { id: 'eraser', icon: <Eraser size={ICON_SIZE} />, label: 'Eraser (E)' },
  ],
  [
    { id: 'fill', icon: <PaintBucket size={ICON_SIZE} />, label: 'Fill (G)' },
    { id: 'gradient', icon: <GalleryVerticalEnd size={ICON_SIZE} />, label: 'Gradient' },
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
  const foregroundColor = useUIStore((s) => s.foregroundColor);
  const backgroundColor = useUIStore((s) => s.backgroundColor);
  const swapColors = useUIStore((s) => s.swapColors);

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
      <div className={styles.colors}>
        <div className={styles.colorStack}>
          <div className={styles.foreground}>
            <ColorSwatch color={foregroundColor} size="md" />
          </div>
          <div className={styles.background}>
            <ColorSwatch color={backgroundColor} size="sm" onClick={swapColors} />
          </div>
        </div>
      </div>
    </div>
  );
}
