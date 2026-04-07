import { useMemo } from 'react';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import type { ToolId } from '../../types';
import { MoveOptions } from './tool-options/MoveOptions';
import { BrushOptions } from './tool-options/BrushOptions';
import { PencilOptions } from './tool-options/PencilOptions';
import { EraserOptions } from './tool-options/EraserOptions';
import { FillOptions } from './tool-options/FillOptions';
import { WandOptions } from './tool-options/WandOptions';
import { MarqueeOptions } from './tool-options/MarqueeOptions';
import { DodgeOptions } from './tool-options/DodgeOptions';
import { ShapeOptions } from './tool-options/ShapeOptions';
import { GradientOptions } from './tool-options/GradientOptions';
import { StampOptions } from './tool-options/StampOptions';
import { PathOptions } from './tool-options/PathOptions';
import { TextOptions } from './tool-options/TextOptions';
import styles from './OptionsBar.module.css';

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

function ToolOptions({ tool }: { tool: ToolId }) {
  switch (tool) {
    case 'move': return <MoveOptions />;
    case 'brush': return <BrushOptions />;
    case 'pencil': return <PencilOptions />;
    case 'eraser': return <EraserOptions />;
    case 'fill': return <FillOptions />;
    case 'wand': return <WandOptions />;
    case 'dodge': return <DodgeOptions />;
    case 'shape': return <ShapeOptions />;
    case 'gradient': return <GradientOptions />;
    case 'stamp': return <StampOptions />;
    case 'path': return <PathOptions />;
    case 'text': return <TextOptions />;
    case 'marquee-rect':
    case 'marquee-ellipse': return <MarqueeOptions />;
    case 'crop': return <span className={styles.hint}>Drag to select crop area</span>;
    default: return null;
  }
}

function computeGridStops(docSize: number): number[] {
  const stops: number[] = [];
  const base = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
  for (const s of base) {
    if (s <= docSize / 2 && s >= Math.max(1, Math.floor(docSize / 500))) {
      stops.push(s);
    }
  }
  if (stops.length === 0) stops.push(Math.max(1, Math.floor(docSize / 4)));
  return stops;
}

export function OptionsBar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const showGrid = useUIStore((s) => s.showGrid);
  const snapToGrid = useUIStore((s) => s.snapToGrid);
  const toggleSnapToGrid = useUIStore((s) => s.toggleSnapToGrid);
  const gridSize = useUIStore((s) => s.gridSize);
  const setGridSize = useUIStore((s) => s.setGridSize);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const label = TOOL_LABELS[activeTool] ?? activeTool;

  const gridStops = useMemo(
    () => computeGridStops(Math.max(docWidth, docHeight)),
    [docWidth, docHeight],
  );

  return (
    <div className={styles.bar}>
      <span className={styles.toolName}>{label}</span>
      <div className={styles.separator} />
      <div className={styles.options}>
        <ToolOptions tool={activeTool} />
      </div>
      {showGrid && (
        <>
          <span className={styles.label}>Grid</span>
          <select
            className={styles.gridSelect}
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
          >
            {gridStops.map((s) => (
              <option key={s} value={s}>{s}px</option>
            ))}
          </select>
          <label className={styles.snapCheckbox}>
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={toggleSnapToGrid}
            />
            Snap
          </label>
        </>
      )}
    </div>
  );
}
