import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { Slider } from '../../components/Slider/Slider';
import { IconButton } from '../../components/IconButton/IconButton';
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from 'lucide-react';
import type { ToolId } from '../../types';
import type { AlignEdge } from '../../tools/move/move';
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

const FONT_OPTIONS = [
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Times New Roman, serif', label: 'Times New Roman' },
  { value: 'Courier New, monospace', label: 'Courier New' },
  { value: 'JetBrains Mono, monospace', label: 'JetBrains Mono' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'Trebuchet MS, sans-serif', label: 'Trebuchet MS' },
  { value: 'Impact, sans-serif', label: 'Impact' },
  { value: 'Comic Sans MS, cursive', label: 'Comic Sans MS' },
  { value: 'Palatino, serif', label: 'Palatino' },
  { value: 'Garamond, serif', label: 'Garamond' },
  { value: 'Brush Script MT, cursive', label: 'Brush Script' },
];

export function OptionsBar() {
  const activeTool = useUIStore((s) => s.activeTool);
  const label = TOOL_LABELS[activeTool] ?? activeTool;

  return (
    <div className={styles.bar}>
      <span className={styles.toolName}>{label}</span>
      <div className={styles.separator} />
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
  const fillContiguous = useToolSettingsStore((s) => s.fillContiguous);
  const shapeMode = useToolSettingsStore((s) => s.shapeMode);
  const shapeFill = useToolSettingsStore((s) => s.shapeFill);
  const shapeStrokeWidth = useToolSettingsStore((s) => s.shapeStrokeWidth);
  const gradientType = useToolSettingsStore((s) => s.gradientType);
  const stampSize = useToolSettingsStore((s) => s.stampSize);
  const pathStrokeWidth = useToolSettingsStore((s) => s.pathStrokeWidth);
  const dodgeExposure = useToolSettingsStore((s) => s.dodgeExposure);
  const dodgeMode = useToolSettingsStore((s) => s.dodgeMode);
  const wandTolerance = useToolSettingsStore((s) => s.wandTolerance);
  const wandContiguous = useToolSettingsStore((s) => s.wandContiguous);
  const textContent = useToolSettingsStore((s) => s.textContent);
  const textFontSize = useToolSettingsStore((s) => s.textFontSize);
  const textFontFamily = useToolSettingsStore((s) => s.textFontFamily);
  const textFontWeight = useToolSettingsStore((s) => s.textFontWeight);
  const textFontStyle = useToolSettingsStore((s) => s.textFontStyle);

  const setBrushSize = useToolSettingsStore((s) => s.setBrushSize);
  const setBrushOpacity = useToolSettingsStore((s) => s.setBrushOpacity);
  const setBrushHardness = useToolSettingsStore((s) => s.setBrushHardness);
  const setPencilSize = useToolSettingsStore((s) => s.setPencilSize);
  const setEraserSize = useToolSettingsStore((s) => s.setEraserSize);
  const setEraserOpacity = useToolSettingsStore((s) => s.setEraserOpacity);
  const setFillTolerance = useToolSettingsStore((s) => s.setFillTolerance);
  const setFillContiguous = useToolSettingsStore((s) => s.setFillContiguous);
  const setShapeMode = useToolSettingsStore((s) => s.setShapeMode);
  const setShapeFill = useToolSettingsStore((s) => s.setShapeFill);
  const setShapeStrokeWidth = useToolSettingsStore((s) => s.setShapeStrokeWidth);
  const setGradientType = useToolSettingsStore((s) => s.setGradientType);
  const setStampSize = useToolSettingsStore((s) => s.setStampSize);
  const setPathStrokeWidth = useToolSettingsStore((s) => s.setPathStrokeWidth);
  const setDodgeExposure = useToolSettingsStore((s) => s.setDodgeExposure);
  const setDodgeMode = useToolSettingsStore((s) => s.setDodgeMode);
  const setWandTolerance = useToolSettingsStore((s) => s.setWandTolerance);
  const setWandContiguous = useToolSettingsStore((s) => s.setWandContiguous);
  const setTextContent = useToolSettingsStore((s) => s.setTextContent);
  const setTextFontSize = useToolSettingsStore((s) => s.setTextFontSize);
  const setTextFontFamily = useToolSettingsStore((s) => s.setTextFontFamily);
  const setTextFontWeight = useToolSettingsStore((s) => s.setTextFontWeight);
  const setTextFontStyle = useToolSettingsStore((s) => s.setTextFontStyle);

  const alignLayer = useEditorStore((s) => s.alignLayer);

  switch (tool) {
    case 'move':
      return (
        <div className={styles.alignGroup}>
          {([
            ['left', AlignHorizontalJustifyStart, 'Align left'],
            ['center-h', AlignHorizontalJustifyCenter, 'Align center horizontally'],
            ['right', AlignHorizontalJustifyEnd, 'Align right'],
            ['top', AlignVerticalJustifyStart, 'Align top'],
            ['center-v', AlignVerticalJustifyCenter, 'Align center vertically'],
            ['bottom', AlignVerticalJustifyEnd, 'Align bottom'],
          ] as const).map(([edge, Icon, label]) => (
            <IconButton
              key={edge}
              icon={<Icon size={16} />}
              label={label}
              onClick={() => alignLayer(edge as AlignEdge)}
            />
          ))}
        </div>
      );
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
      return (
        <>
          <Slider label="Tolerance" value={fillTolerance} min={0} max={255} onChange={setFillTolerance} />
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={fillContiguous}
              onChange={(e) => setFillContiguous(e.target.checked)}
            />
            Contiguous
          </label>
        </>
      );
    case 'wand':
      return (
        <>
          <Slider label="Tolerance" value={wandTolerance} min={0} max={255} onChange={setWandTolerance} />
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={wandContiguous}
              onChange={(e) => setWandContiguous(e.target.checked)}
            />
            Contiguous
          </label>
        </>
      );
    case 'dodge':
      return (
        <>
          <span className={styles.label}>Mode</span>
          <select
            className={styles.select}
            value={dodgeMode}
            onChange={(e) => setDodgeMode(e.target.value as 'dodge' | 'burn')}
          >
            <option value="dodge">Dodge</option>
            <option value="burn">Burn</option>
          </select>
          <Slider label="Exposure" value={dodgeExposure} min={1} max={100} onChange={setDodgeExposure} />
          <Slider label="Size" value={brushSize} min={1} max={200} onChange={setBrushSize} />
        </>
      );
    case 'shape':
      return (
        <>
          <span className={styles.label}>Shape</span>
          <select
            className={styles.select}
            value={shapeMode}
            onChange={(e) => setShapeMode(e.target.value as 'rectangle' | 'ellipse')}
          >
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
          </select>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={shapeFill}
              onChange={(e) => setShapeFill(e.target.checked)}
            />
            Fill
          </label>
          {!shapeFill && (
            <Slider label="Stroke" value={shapeStrokeWidth} min={1} max={50} onChange={setShapeStrokeWidth} />
          )}
        </>
      );
    case 'gradient':
      return (
        <>
          <span className={styles.label}>Type</span>
          <select
            className={styles.select}
            value={gradientType}
            onChange={(e) => setGradientType(e.target.value as 'linear' | 'radial')}
          >
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
          </select>
        </>
      );
    case 'stamp':
      return (
        <>
          <Slider label="Size" value={stampSize} min={1} max={200} onChange={setStampSize} />
          <span className={styles.hint}>Alt+click to set source</span>
        </>
      );
    case 'path':
      return (
        <>
          <Slider label="Stroke" value={pathStrokeWidth} min={1} max={50} onChange={setPathStrokeWidth} />
          <span className={styles.hint}>Enter to stroke, Esc to cancel</span>
        </>
      );
    case 'text':
      return (
        <>
          <span className={styles.label}>Text</span>
          <input
            className={styles.textInput}
            type="text"
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
          />
          <Slider label="Size" value={textFontSize} min={1} max={500} onChange={setTextFontSize} />
          <span className={styles.label}>Font</span>
          <select
            className={styles.select}
            value={textFontFamily}
            onChange={(e) => setTextFontFamily(e.target.value)}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={textFontWeight}
            onChange={(e) => setTextFontWeight(Number(e.target.value))}
          >
            <option value={400}>Normal</option>
            <option value={700}>Bold</option>
          </select>
          <select
            className={styles.select}
            value={textFontStyle}
            onChange={(e) => setTextFontStyle(e.target.value as 'normal' | 'italic')}
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </>
      );
    case 'crop':
      return <span className={styles.hint}>Drag to select crop area</span>;
    default:
      return null;
  }
}
