import styles from './Slider.module.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  onChange: (value: number) => void;
  showValue?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  label,
  onChange,
  showValue = true,
}: SliderProps) {
  return (
    <div className={styles.container}>
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
