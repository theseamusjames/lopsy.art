import { useRef } from 'react';
import { Slider } from '@lopsy/ui/Slider';
import { formatValue, parseValue } from './readout';

/** How a value box shows and reads values that are not the value itself (Temperature in Kelvin). */
export interface SliderReadout {
  readonly format: (value: number) => string;
  /** The value for typed text, or null when it is not one. */
  readonly parse: (text: string) => number | null;
}

export interface EditSliderProps extends Partial<SliderReadout> {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Double-click resets to this. */
  readonly defaultValue: number;
  readonly disabled?: boolean;
  /** Read after the value by screen readers ("+0.50 EV"); the value box is unchanged. */
  readonly unit?: string;
  /** Every change while the slider moves. */
  readonly onChange: (value: number) => void;
  /** Once a change is let go (pointer up, key up, a typed or reset value); never when nothing changed. */
  readonly onCommit: (value: number) => void;
}

/**
 * The shared slider as the Edit view uses it: value boxes read '+0.50',
 * '−12' and '0' unless `format` and `parse` say otherwise. The shared
 * slider also commits on a key-up or pointer-up that changed nothing (a
 * Tab onto it, a press on its thumb); here a commit is a history step, and
 * on Temperature or Tint it makes the white balance Custom, so only a
 * change is committed.
 */
export function EditSlider({ min, max, step, format, parse, onChange, onCommit, ...props }: EditSliderProps) {
  const hasChanged = useRef(false);
  const range = { min, max, step };
  return (
    <Slider
      {...props}
      min={min}
      max={max}
      step={step}
      format={format ?? ((value) => formatValue(value, range))}
      parse={parse ?? ((text) => parseValue(text, range))}
      onChange={(value) => {
        hasChanged.current = true;
        onChange(value);
      }}
      onCommit={(value) => {
        if (!hasChanged.current) return;
        hasChanged.current = false;
        onCommit(value);
      }}
    />
  );
}
