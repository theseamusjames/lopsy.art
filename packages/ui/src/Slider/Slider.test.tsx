// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Slider, commitSliderValue, sliderFill, sliderKnobPosition, type SliderProps } from './Slider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('commitSliderValue', () => {
  it('clamps a typed value above max down to max', () => {
    expect(commitSliderValue('15', 0, -5, 5)).toBe(5);
  });

  it('clamps a typed value below min up to min', () => {
    expect(commitSliderValue('-100', 0, -5, 5)).toBe(-5);
  });

  it('returns an in-range value unchanged', () => {
    expect(commitSliderValue('2.5', 0, -5, 5)).toBe(2.5);
  });

  it('returns the current value when the input cannot be parsed', () => {
    expect(commitSliderValue('abc', 1.25, 0, 10)).toBe(1.25);
    expect(commitSliderValue('', 1.25, 0, 10)).toBe(1.25);
  });

  it('clamps a value at the exact max boundary', () => {
    expect(commitSliderValue('5', 0, -5, 5)).toBe(5);
  });

  it('clamps a value at the exact min boundary', () => {
    expect(commitSliderValue('-5', 0, -5, 5)).toBe(-5);
  });

  it('handles fractional ranges (e.g. opacity 0..1)', () => {
    expect(commitSliderValue('1.7', 0.5, 0, 1)).toBe(1);
    expect(commitSliderValue('-0.2', 0.5, 0, 1)).toBe(0);
    expect(commitSliderValue('0.3', 0.5, 0, 1)).toBe(0.3);
  });

  it('regression: Exposure typing 15 with max=5 must not commit 15', () => {
    // Issue #261: typing 15 into Exposure (max=5) was producing 2^15 multiplier
    // and blowing every pixel to white. After the fix, the commit should clamp
    // to the declared max so the on-canvas effect stays bounded.
    const result = commitSliderValue('15', 0, -5, 5);
    expect(result).toBe(5);
    expect(result).toBeLessThanOrEqual(5);
  });
});

describe('sliderKnobPosition', () => {
  it('returns the value unchanged when within slider range (linear)', () => {
    expect(sliderKnobPosition(150, 1, 300)).toBe(150);
  });

  it('clamps a value above sliderMax to sliderMax (linear)', () => {
    // Issue #364: brush size can be typed up to e.g. 2880 but the slider
    // visual range is 1..300. The knob must pin at sliderMax so it stays
    // visible at the right edge instead of overflowing.
    expect(sliderKnobPosition(2880, 1, 300)).toBe(300);
  });

  it('clamps a value below sliderMin to sliderMin (linear)', () => {
    expect(sliderKnobPosition(-10, 1, 300)).toBe(1);
  });

  it('maps log scale within bounds and clamps outside the range', () => {
    // At sliderMin and sliderMax the log mapping is identity (norm 0 and 1).
    expect(sliderKnobPosition(1, 1, 1000, 'log')).toBe(1);
    expect(sliderKnobPosition(1000, 1, 1000, 'log')).toBe(1000);
    // A value beyond sliderMax must clamp before the log mapping so the knob
    // doesn't slide off the right end of the track.
    expect(sliderKnobPosition(5000, 1, 1000, 'log')).toBe(1000);
  });
});

let root: Root | null = null;

function render(ui: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(ui));
  return host;
}

function Stateful(props: Omit<SliderProps, 'value' | 'onChange'> & { initial: number; onChange?: (value: number) => void }) {
  const { initial, onChange, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <Slider
      {...rest}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

function rangeOf(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[type="range"]');
  if (!input) throw new Error('no range');
  return input;
}

function valueBoxOf(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[type="text"]');
  if (!input) throw new Error('no value box');
  return input;
}

/** Sets an input's value the way the browser does, so React sees the change. */
function setValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function fire(target: Element, type: string, init: KeyboardEventInit = {}): void {
  act(() => {
    const event = type.startsWith('key') ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }) : new Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
  });
}

function typeInto(box: HTMLInputElement, text: string): void {
  act(() => box.focus());
  act(() => setValue(box, text));
  fire(box, 'keydown', { key: 'Enter' });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('sliderFill', () => {
  const at = (f: number) => `calc(10px + (100% - 20px) * ${f})`;

  it('fills a range either side of 0 from 0, in both directions', () => {
    expect(sliderFill(50, -100, 100)).toEqual({ from: at(0.5), to: at(0.75) });
    expect(sliderFill(-40, -100, 100)).toEqual({ from: at(0.3), to: at(0.5) });
  });

  it('fills a one-sided range from its start, reaching the track\'s ends', () => {
    expect(sliderFill(25, 0, 100)).toEqual({ from: '0%', to: at(0.25) });
    expect(sliderFill(100, 0, 100)).toEqual({ from: '0%', to: '100%' });
  });

  it('shows no fill when the value is where the fill starts', () => {
    expect(sliderFill(0, -100, 100)).toEqual({ from: at(0.5), to: at(0.5) });
    expect(sliderFill(0, 0, 100)).toEqual({ from: '0%', to: '0%' });
    expect(sliderFill(5000, 2000, 12000, 'linear', 5000)).toEqual({ from: at(0.3), to: at(0.3) });
  });

  it('fills from fillFrom when given, such as a default value', () => {
    expect(sliderFill(3000, 2000, 12000, 'linear', 5000)).toEqual({ from: at(0.1), to: at(0.3) });
    expect(sliderFill(80, 0, 100, 'linear', 50)).toEqual({ from: at(0.5), to: at(0.8) });
  });

  it('places the edges in the knob\'s scale', () => {
    expect(sliderFill(10, 1, 100, 'log')).toEqual({ from: '0%', to: at(0.5) });
  });
});

describe('Slider', () => {
  it('shows the value through format and reads typed text through parse', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const host = render(
      <Stateful
        initial={0.5}
        min={-5}
        max={5}
        step={0.01}
        label="Exposure"
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`}
        parse={(text) => {
          const n = Number(text.replace(',', '.'));
          return Number.isFinite(n) ? n : null;
        }}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );
    const box = valueBoxOf(host);
    expect(box.value).toBe('+0.50');
    typeInto(box, '1,25');
    expect(onChange).toHaveBeenLastCalledWith(1.25);
    expect(onCommit).toHaveBeenLastCalledWith(1.25);
    expect(box.value).toBe('+1.25');

    typeInto(box, 'twelve');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(box.value).toBe('+1.25');

    typeInto(box, '9');
    expect(onCommit).toHaveBeenLastCalledWith(5);
    expect(box.value).toBe('+5.00');
  });

  it('keeps String and parseFloat when given neither', () => {
    const onCommit = vi.fn();
    const host = render(<Stateful initial={10} min={0} max={100} label="Size" onCommit={onCommit} />);
    const box = valueBoxOf(host);
    expect(box.value).toBe('10');
    typeInto(box, '12abc');
    expect(onCommit).toHaveBeenLastCalledWith(12);
    expect(box.value).toBe('12');
  });

  it('commits the value a drag ended on, even before the parent re-renders', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const onDragStart = vi.fn();
    const host = render(<Slider value={10} min={0} max={100} label="Size" onChange={onChange} onCommit={onCommit} onDragStart={onDragStart} />);
    const range = rangeOf(host);
    fire(range, 'pointerdown');
    act(() => setValue(range, '30'));
    act(() => setValue(range, '42'));
    fire(range, 'pointerup');
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(42);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(42);

    fire(range, 'keydown', { key: 'Tab' });
    fire(range, 'keyup', { key: 'Tab' });
    expect(onCommit).toHaveBeenLastCalledWith(10);
  });

  it('commits a step from the value box and a double-click reset with their values', () => {
    const onCommit = vi.fn();
    const host = render(<Stateful initial={10} min={0} max={100} step={5} defaultValue={50} label="Size" onCommit={onCommit} />);
    const box = valueBoxOf(host);
    act(() => box.focus());
    fire(box, 'keydown', { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith(15);
    act(() => box.blur());
    fire(host.firstElementChild as Element, 'dblclick');
    expect(onCommit).toHaveBeenLastCalledWith(50);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('disables the range and the value box, and ignores a double-click', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const host = render(<Slider value={10} min={0} max={100} defaultValue={50} label="Size" disabled onChange={onChange} onCommit={onCommit} />);
    expect(rangeOf(host).disabled).toBe(true);
    expect(valueBoxOf(host).disabled).toBe(true);
    expect(host.firstElementChild?.hasAttribute('data-disabled')).toBe(true);
    fire(host.firstElementChild as Element, 'dblclick');
    fire(rangeOf(host), 'pointerdown');
    fire(rangeOf(host), 'pointerup');
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('is enabled unless disabled is set', () => {
    const host = render(<Slider value={10} min={0} max={100} label="Size" onChange={() => undefined} />);
    expect(rangeOf(host).disabled).toBe(false);
    expect(valueBoxOf(host).disabled).toBe(false);
    expect(host.firstElementChild?.hasAttribute('data-disabled')).toBe(false);
  });

  it('draws the fill from where the value starts to the thumb', () => {
    const host = render(<Slider value={20} min={-100} max={100} onChange={() => undefined} />);
    const style = rangeOf(host).style;
    expect(style.getPropertyValue('--slider-fill-from')).toBe('calc(10px + (100% - 20px) * 0.5)');
    expect(style.getPropertyValue('--slider-fill-to')).toBe('calc(10px + (100% - 20px) * 0.6)');
  });

  it('names the range and the value box after the label', () => {
    const host = render(<Slider value={10} min={0} max={100} label="Opacity" onChange={() => undefined} />);
    expect(rangeOf(host).getAttribute('aria-label')).toBe('Opacity');
    expect(valueBoxOf(host).getAttribute('aria-label')).toBe('Opacity value');
  });

  it('says the formatted value with its unit, or else its suffix', () => {
    const format = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
    const withUnit = render(<Slider value={0.5} min={-5} max={5} step={0.01} label="Exposure" unit="EV" format={format} onChange={() => undefined} />);
    expect(rangeOf(withUnit).getAttribute('aria-valuetext')).toBe('+0.50 EV');
    act(() => root?.unmount());

    const withSuffix = render(<Slider value={75} min={0} max={100} label="Opacity" suffix="%" onChange={() => undefined} />);
    expect(rangeOf(withSuffix).getAttribute('aria-valuetext')).toBe('75 %');
    act(() => root?.unmount());

    const both = render(<Slider value={12} min={0} max={100} label="Size" suffix="px" unit="pixels" onChange={() => undefined} />);
    expect(rangeOf(both).getAttribute('aria-valuetext')).toBe('12 pixels');
    act(() => root?.unmount());

    const bare = render(<Slider value={2880} min={1} max={5000} sliderMax={300} label="Size" onChange={() => undefined} />);
    expect(rangeOf(bare).getAttribute('aria-valuetext')).toBe('2880');
    expect(rangeOf(bare).value).toBe('300');
  });
});
