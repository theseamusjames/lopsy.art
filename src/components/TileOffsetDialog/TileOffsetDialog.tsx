import { useState, useCallback } from 'react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { useEditorStore } from '../../app/editor-store';
import { docScaledMax } from '../../utils/slider-ranges';
import styles from './TileOffsetDialog.module.css';

interface TileOffsetSettings {
  offsetX: number;
  offsetY: number;
  wrap: boolean;
}

interface TileOffsetDialogProps {
  onApply: (settings: TileOffsetSettings) => void;
  onCancel: () => void;
}

export type { TileOffsetSettings, TileOffsetDialogProps };

export function TileOffsetDialog({ onApply, onCancel }: TileOffsetDialogProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [wrap, setWrap] = useState(true);
  const { offset, dragProps } = useDraggablePanel();

  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const maxOffset = docScaledMax(docWidth, docHeight, 100);

  const handleApply = useCallback(() => {
    onApply({ offsetX, offsetY, wrap });
  }, [onApply, offsetX, offsetY, wrap]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [handleApply, onCancel],
  );

  const handleHalfWidth = useCallback(() => {
    setOffsetX(Math.round(docWidth / 2));
  }, [docWidth]);

  const handleHalfHeight = useCallback(() => {
    setOffsetY(Math.round(docHeight / 2));
  }, [docHeight]);

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Offset"
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <div className={styles.header} {...dragProps}>
          <h2>Offset</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.sliderRow}>
            <Slider
              label="Horizontal"
              value={offsetX}
              min={-maxOffset}
              max={maxOffset}
              step={1}
              onChange={setOffsetX}
            />
            <button
              className={styles.halfButton}
              type="button"
              onClick={handleHalfWidth}
              aria-label="Set to half width"
            >
              Half Width
            </button>
          </div>
          <div className={styles.sliderRow}>
            <Slider
              label="Vertical"
              value={offsetY}
              min={-maxOffset}
              max={maxOffset}
              step={1}
              onChange={setOffsetY}
            />
            <button
              className={styles.halfButton}
              type="button"
              onClick={handleHalfHeight}
              aria-label="Set to half height"
            >
              Half Height
            </button>
          </div>
          <label className={styles.checkboxOption}>
            <input
              type="checkbox"
              checked={wrap}
              onChange={(e) => setWrap(e.target.checked)}
            />
            Wrap Around
          </label>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={styles.applyButton} onClick={handleApply} type="button">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
