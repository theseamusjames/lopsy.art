import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import styles from '../OptionsBar.module.css';

export function ShapeOptions() {
  const shapeMode = useToolSettingsStore((s) => s.shapeMode);
  const shapeFill = useToolSettingsStore((s) => s.shapeFill);
  const shapeStrokeWidth = useToolSettingsStore((s) => s.shapeStrokeWidth);
  const setShapeMode = useToolSettingsStore((s) => s.setShapeMode);
  const setShapeFill = useToolSettingsStore((s) => s.setShapeFill);
  const setShapeStrokeWidth = useToolSettingsStore((s) => s.setShapeStrokeWidth);

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
}
