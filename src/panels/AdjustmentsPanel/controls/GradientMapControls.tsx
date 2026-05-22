import { useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { IconButton } from '../../../components/IconButton/IconButton';
import { GradientEditor } from '../../../components/GradientEditor/GradientEditor';
import { ColorPicker } from '../../../components/ColorPicker/ColorPicker';
import type { GradientStop } from '../../../tools/gradient/gradient';
import type { Color } from '../../../types';
import type { GradientMapNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

export function GradientMapControls({ node, onChange }: NodeControlProps<GradientMapNode>) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const sorted = [...node.stops].sort((a, b) => a.position - b.position);
  const selectedStop = sorted[selectedIndex];

  const handleStopsChange = useCallback((stops: readonly GradientStop[]) => {
    onChange({ stops });
  }, [onChange]);

  const handleColorChange = useCallback((color: Color) => {
    const newStops = sorted.map((stop, i) =>
      i === selectedIndex ? { ...stop, color } : stop,
    );
    onChange({ stops: newStops });
  }, [sorted, selectedIndex, onChange]);

  const handleDelete = useCallback(() => {
    if (node.stops.length <= 2) return;
    const newStops = sorted.filter((_, i) => i !== selectedIndex);
    onChange({ stops: newStops });
    setSelectedIndex(Math.min(selectedIndex, newStops.length - 1));
  }, [node.stops.length, sorted, selectedIndex, onChange]);

  return (
    <div className={styles.gradientMapSection}>
      <GradientEditor
        stops={sorted}
        selectedIndex={selectedIndex}
        onStopsChange={handleStopsChange}
        onSelectStop={setSelectedIndex}
      />
      <div className={styles.gradientStopInfo}>
        {selectedStop && (
          <>
            <div
              className={styles.stopColorPreview}
              style={{ backgroundColor: `rgb(${selectedStop.color.r},${selectedStop.color.g},${selectedStop.color.b})` }}
            />
            <span>Stop {selectedIndex + 1} of {sorted.length}</span>
            <span>Position: {Math.round(selectedStop.position * 100)}%</span>
            <IconButton
              icon={<Trash2 size={12} />}
              label="Delete stop"
              onClick={handleDelete}
              disabled={node.stops.length <= 2}
            />
          </>
        )}
      </div>
      {selectedStop && (
        <ColorPicker color={selectedStop.color} onChange={handleColorChange} />
      )}
    </div>
  );
}
