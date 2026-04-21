import { useState, useCallback } from 'react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import styles from './NoiseDialog.module.css';

interface NoiseDialogProps {
  title: string;
  onApply: (settings: { amount: number; type: 'gaussian' | 'uniform'; monochromatic: boolean }) => void;
  onCancel: () => void;
}

interface FillNoiseDialogProps {
  title: string;
  onApply: (settings: { type: 'gaussian' | 'uniform'; monochromatic: boolean }) => void;
  onCancel: () => void;
}

export type { NoiseDialogProps, FillNoiseDialogProps };

export function NoiseDialog({ title, onApply, onCancel }: NoiseDialogProps) {
  const [amount, setAmount] = useState(25);
  const [noiseType, setNoiseType] = useState<'gaussian' | 'uniform'>('gaussian');
  const [isMonochromatic, setIsMonochromatic] = useState(false);
  const { offset, dragProps } = useDraggablePanel();

  const handleApply = useCallback(() => {
    onApply({ amount, type: noiseType, monochromatic: isMonochromatic });
  }, [onApply, amount, noiseType, isMonochromatic]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [handleApply, onCancel]);

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label={title}
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        {...dragProps}
      >
        <div className={styles.header}>
          <h2>{title}</h2>
        </div>
        <div className={styles.body}>
          <Slider
            label="Amount"
            value={amount}
            min={1}
            max={100}
            step={1}
            onChange={setAmount}
          />
          <div className={styles.optionRow}>
            <span className={styles.optionLabel}>Type</span>
            <div className={styles.radioGroup}>
              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name="noise-type"
                  checked={noiseType === 'gaussian'}
                  onChange={() => setNoiseType('gaussian')}
                />
                Gaussian
              </label>
              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name="noise-type"
                  checked={noiseType === 'uniform'}
                  onChange={() => setNoiseType('uniform')}
                />
                Uniform
              </label>
            </div>
          </div>
          <label className={styles.checkboxOption}>
            <input
              type="checkbox"
              checked={isMonochromatic}
              onChange={(e) => setIsMonochromatic(e.target.checked)}
            />
            Monochromatic
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

export function FillNoiseDialog({ title, onApply, onCancel }: FillNoiseDialogProps) {
  const [noiseType, setNoiseType] = useState<'gaussian' | 'uniform'>('gaussian');
  const [isMonochromatic, setIsMonochromatic] = useState(false);
  const { offset, dragProps } = useDraggablePanel();

  const handleApply = useCallback(() => {
    onApply({ type: noiseType, monochromatic: isMonochromatic });
  }, [onApply, noiseType, isMonochromatic]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [handleApply, onCancel]);

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label={title}
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        {...dragProps}
      >
        <div className={styles.header}>
          <h2>{title}</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.optionRow}>
            <span className={styles.optionLabel}>Type</span>
            <div className={styles.radioGroup}>
              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name="fill-noise-type"
                  checked={noiseType === 'gaussian'}
                  onChange={() => setNoiseType('gaussian')}
                />
                Gaussian
              </label>
              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name="fill-noise-type"
                  checked={noiseType === 'uniform'}
                  onChange={() => setNoiseType('uniform')}
                />
                Uniform
              </label>
            </div>
          </div>
          <label className={styles.checkboxOption}>
            <input
              type="checkbox"
              checked={isMonochromatic}
              onChange={(e) => setIsMonochromatic(e.target.checked)}
            />
            Monochromatic
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
