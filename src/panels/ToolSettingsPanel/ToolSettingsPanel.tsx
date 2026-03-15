import { useUIStore } from '../../app/ui-store';
import { BrushOptions } from '../../app/OptionsBar/tool-options/BrushOptions';
import { PencilOptions } from '../../app/OptionsBar/tool-options/PencilOptions';
import { EraserOptions } from '../../app/OptionsBar/tool-options/EraserOptions';
import { FillOptions } from '../../app/OptionsBar/tool-options/FillOptions';
import { WandOptions } from '../../app/OptionsBar/tool-options/WandOptions';
import { DodgeOptions } from '../../app/OptionsBar/tool-options/DodgeOptions';
import { ShapeOptions } from '../../app/OptionsBar/tool-options/ShapeOptions';
import { GradientOptions } from '../../app/OptionsBar/tool-options/GradientOptions';
import { StampOptions } from '../../app/OptionsBar/tool-options/StampOptions';
import { PathOptions } from '../../app/OptionsBar/tool-options/PathOptions';
import { TextOptions } from '../../app/OptionsBar/tool-options/TextOptions';
import type { ToolId } from '../../types';
import styles from './ToolSettingsPanel.module.css';

function PanelToolOptions({ tool }: { tool: ToolId }) {
  switch (tool) {
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
    case 'crop':
      return <span className={styles.label}>Drag to select crop area</span>;
    default:
      return <div className={styles.empty}>No settings for this tool</div>;
  }
}

export function ToolSettingsPanel() {
  const activeTool = useUIStore((s) => s.activeTool);

  return (
    <div className={styles.panel}>
      <PanelToolOptions tool={activeTool} />
    </div>
  );
}
