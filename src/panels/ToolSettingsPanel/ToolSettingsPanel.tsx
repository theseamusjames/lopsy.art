import { useUIStore } from '../../app/ui-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { Slider } from '../../components/Slider/Slider';
import type { ToolId } from '../../types';
import styles from './ToolSettingsPanel.module.css';

export function ToolSettingsPanel() {
  const activeTool = useUIStore((s) => s.activeTool);
  return <ToolOptions tool={activeTool} />;
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

  switch (tool) {
    case 'brush':
      return (
        <div className={styles.panel}>
          <Slider label="Size" value={brushSize} min={1} max={200} onChange={setBrushSize} />
          <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
          <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
        </div>
      );
    case 'pencil':
      return (
        <div className={styles.panel}>
          <Slider label="Size" value={pencilSize} min={1} max={100} onChange={setPencilSize} />
        </div>
      );
    case 'eraser':
      return (
        <div className={styles.panel}>
          <Slider label="Size" value={eraserSize} min={1} max={200} onChange={setEraserSize} />
          <Slider label="Opacity" value={eraserOpacity} min={1} max={100} onChange={setEraserOpacity} />
        </div>
      );
    case 'fill':
      return (
        <div className={styles.panel}>
          <Slider label="Tolerance" value={fillTolerance} min={0} max={255} onChange={setFillTolerance} />
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={fillContiguous}
              onChange={(e) => setFillContiguous(e.target.checked)}
            />
            Contiguous
          </label>
        </div>
      );
    case 'wand':
      return (
        <div className={styles.panel}>
          <Slider label="Tolerance" value={wandTolerance} min={0} max={255} onChange={setWandTolerance} />
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={wandContiguous}
              onChange={(e) => setWandContiguous(e.target.checked)}
            />
            Contiguous
          </label>
        </div>
      );
    case 'dodge':
      return (
        <div className={styles.panel}>
          <div className={styles.row}>
            <span className={styles.label}>Mode</span>
            <select
              className={styles.select}
              value={dodgeMode}
              onChange={(e) => setDodgeMode(e.target.value as 'dodge' | 'burn')}
            >
              <option value="dodge">Dodge (Lighten)</option>
              <option value="burn">Burn (Darken)</option>
            </select>
          </div>
          <Slider label="Exposure" value={dodgeExposure} min={1} max={100} onChange={setDodgeExposure} />
          <Slider label="Size" value={brushSize} min={1} max={200} onChange={setBrushSize} />
        </div>
      );
    case 'shape':
      return (
        <div className={styles.panel}>
          <div className={styles.row}>
            <span className={styles.label}>Shape</span>
            <select
              className={styles.select}
              value={shapeMode}
              onChange={(e) => setShapeMode(e.target.value as 'rectangle' | 'ellipse')}
            >
              <option value="rectangle">Rectangle</option>
              <option value="ellipse">Ellipse</option>
            </select>
          </div>
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
        </div>
      );
    case 'gradient':
      return (
        <div className={styles.panel}>
          <div className={styles.row}>
            <span className={styles.label}>Type</span>
            <select
              className={styles.select}
              value={gradientType}
              onChange={(e) => setGradientType(e.target.value as 'linear' | 'radial')}
            >
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
            </select>
          </div>
        </div>
      );
    case 'stamp':
      return (
        <div className={styles.panel}>
          <Slider label="Size" value={stampSize} min={1} max={200} onChange={setStampSize} />
          <div className={styles.row}>
            <span className={styles.label}>Alt+click to set source</span>
          </div>
        </div>
      );
    case 'path':
      return (
        <div className={styles.panel}>
          <Slider label="Stroke" value={pathStrokeWidth} min={1} max={50} onChange={setPathStrokeWidth} />
          <div className={styles.row}>
            <span className={styles.label}>Enter to stroke, Esc to cancel</span>
          </div>
        </div>
      );
    case 'text':
      return (
        <div className={styles.panel}>
          <div className={styles.row}>
            <span className={styles.label}>Text</span>
            <input
              className={styles.select}
              type="text"
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
            />
          </div>
          <Slider label="Size" value={textFontSize} min={1} max={500} onChange={setTextFontSize} />
          <div className={styles.row}>
            <span className={styles.label}>Font</span>
            <select
              className={styles.select}
              value={textFontFamily}
              onChange={(e) => setTextFontFamily(e.target.value)}
            >
              <option value="sans-serif">Sans Serif</option>
              <option value="serif">Serif</option>
              <option value="monospace">Monospace</option>
              <option value="cursive">Cursive</option>
            </select>
          </div>
        </div>
      );
    case 'crop':
      return (
        <div className={styles.panel}>
          <div className={styles.row}>
            <span className={styles.label}>Drag to select crop area</span>
          </div>
        </div>
      );
    default:
      return <div className={styles.empty}>No settings for this tool</div>;
  }
}
