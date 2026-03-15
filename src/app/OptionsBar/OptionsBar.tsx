import { useUIStore } from '../ui-store';
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

export function OptionsBar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const showGrid = useUIStore((s) => s.showGrid);
  const snapToGrid = useUIStore((s) => s.snapToGrid);
  const toggleSnapToGrid = useUIStore((s) => s.toggleSnapToGrid);
  const gridSize = useUIStore((s) => s.gridSize);
  const setGridSize = useUIStore((s) => s.setGridSize);
  const label = TOOL_LABELS[activeTool] ?? activeTool;

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
          <input
            className={styles.gridSlider}
            type="range"
            min={4}
            max={128}
            step={1}
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value))}
          />
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
