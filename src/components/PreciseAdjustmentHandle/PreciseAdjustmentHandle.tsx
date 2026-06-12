import styles from './PreciseAdjustmentHandle.module.css';

interface PreciseAdjustmentHandleProps {
  position: number;
  swatch: string;
  active?: boolean;
  ariaLabel: string;
  ariaValueMin?: number;
  ariaValueMax?: number;
  ariaValueNow?: number;
  testId?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function PreciseAdjustmentHandle({
  position,
  swatch,
  active,
  ariaLabel,
  ariaValueMin = 0,
  ariaValueMax = 100,
  ariaValueNow,
  testId,
  onPointerDown,
  onMouseDown,
  onClick,
}: PreciseAdjustmentHandleProps) {
  const left = `${Math.max(0, Math.min(1, position)) * 100}%`;
  return (
    <div
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      aria-valuenow={ariaValueNow ?? Math.round(position * ariaValueMax)}
      tabIndex={0}
      className={`${styles.handle} ${active ? styles.handleActive : ''}`}
      data-testid={testId}
      style={{ '--handle-x': left, '--handle-color': swatch } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onClick={onClick}
    />
  );
}
