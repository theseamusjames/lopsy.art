import { useMemo } from 'react';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { toolRegistry } from '../../tools/tool-registry';
import styles from './OptionsBar.module.css';

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

  const descriptor = toolRegistry[activeTool];
  const label = descriptor?.label ?? activeTool;
  const Options = descriptor?.optionsComponent;

  const gridStops = useMemo(
    () => computeGridStops(Math.max(docWidth, docHeight)),
    [docWidth, docHeight],
  );

  return (
    <div className={styles.bar}>
      <span className={styles.toolName}>{label}</span>
      <div className={styles.separator} />
      <div className={styles.options}>
        {Options ? <Options /> : null}
      </div>
      {showGrid && (
        <>
          <span className={styles.label}>Grid</span>
          <input
            type="range"
            className={styles.gridSlider}
            min={0}
            max={gridStops.length - 1}
            step={1}
            value={gridStops.indexOf(gridSize) !== -1
              ? gridStops.indexOf(gridSize)
              : gridStops.reduce((best, s, i) =>
                  Math.abs(s - gridSize) < Math.abs(gridStops[best]! - gridSize) ? i : best, 0)}
            onChange={(e) => setGridSize(gridStops[Number(e.target.value)]!)}
          />
          <span className={styles.gridValue}>{gridSize}px</span>
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
