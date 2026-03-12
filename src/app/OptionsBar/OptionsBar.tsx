import { useUIStore } from '../ui-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { Slider } from '../../components/Slider/Slider';
import type { ToolId } from '../../types';
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

export function OptionsBar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const label = TOOL_LABELS[activeTool] ?? activeTool;

  return (
    <div className={styles.bar}>
      <span className={styles.toolName}>{label}</span>
      <div className={styles.options}>
        <ToolOptions tool={activeTool} />
      </div>
    </div>
  );
}

function ToolOptions({ tool }: { tool: ToolId }) {
  const brushSize = useToolSettingsStore((s) => s.brushSize);
  const brushOpacity = useToolSettingsStore((s) => s.brushOpacity);
  const brushHardness = useToolSettingsStore((s) => s.brushHardness);
  const pencilSize = useToolSettingsStore((s) => s.pencilSize);
  const eraserSize = useToolSettingsStore((s) => s.eraserSize);
  const eraserOpacity = useToolSettingsStore((s) => s.eraserOpacity);
  const fillTolerance = useToolSettingsStore((s) => s.fillTolerance);

  const setBrushSize = useToolSettingsStore((s) => s.setBrushSize);
  const setBrushOpacity = useToolSettingsStore((s) => s.setBrushOpacity);
  const setBrushHardness = useToolSettingsStore((s) => s.setBrushHardness);
  const setPencilSize = useToolSettingsStore((s) => s.setPencilSize);
  const setEraserSize = useToolSettingsStore((s) => s.setEraserSize);
  const setEraserOpacity = useToolSettingsStore((s) => s.setEraserOpacity);
  const setFillTolerance = useToolSettingsStore((s) => s.setFillTolerance);

  switch (tool) {
    case 'brush':
      return (
        <>
          <Slider label="Size" value={brushSize} min={1} max={200} onChange={setBrushSize} />
          <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
          <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
        </>
      );
    case 'pencil':
      return <Slider label="Size" value={pencilSize} min={1} max={100} onChange={setPencilSize} />;
    case 'eraser':
      return (
        <>
          <Slider label="Size" value={eraserSize} min={1} max={200} onChange={setEraserSize} />
          <Slider label="Opacity" value={eraserOpacity} min={1} max={100} onChange={setEraserOpacity} />
        </>
      );
    case 'fill':
      return <Slider label="Tolerance" value={fillTolerance} min={0} max={255} onChange={setFillTolerance} />;
    default:
      return null;
  }
}
