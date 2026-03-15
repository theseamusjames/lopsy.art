import styles from './Slider.module.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  defaultValue?: number;
  onChange: (value: number) => void;
  showValue?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  label,
  defaultValue,
  onChange,
  showValue = true,
}: SliderProps) {
  const handleDoubleClick = () => {
    onChange(defaultValue ?? min);
  };

  return (
    <div className={styles.container} onDoubleClick={handleDoubleClick}>
      {label && <span className={styles.label}>{label}</span>}
      <input
        type="range"
        className={styles.input}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {showValue && <span className={styles.value}>{value}</span>}
    </div>
  );
}
