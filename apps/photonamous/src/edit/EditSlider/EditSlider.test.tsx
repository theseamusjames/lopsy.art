// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditSlider } from './EditSlider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function Exposure({ onCommit, format }: { onCommit: (value: number) => void; format?: (value: number) => string }) {
  const [value, setValue] = useState(0.5);
  return (
    <EditSlider
      label="Exposure"
      value={value}
      min={-5}
      max={5}
      step={0.01}
      defaultValue={0}
      {...(format ? {} : { unit: 'EV' })}
      onChange={setValue}
      onCommit={onCommit}
      {...(format ? { format, parse: (text: string) => Number(text) } : {})}
    />
  );
}

function mount(ui: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(ui));
  return host;
}

function input(host: HTMLElement, type: 'range' | 'text'): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`input[type="${type}"]`);
  if (!el) throw new Error(`no ${type} input`);
  return el;
}

function fire(target: Element, event: Event): void {
  act(() => {
    target.dispatchEvent(event);
  });
}

function setRange(range: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(range, value);
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('EditSlider', () => {
  it('reads like the Edit view: signed, to the step, with the unit for screen readers', () => {
    const host = mount(<Exposure onCommit={() => undefined} />);
    expect(input(host, 'text').value).toBe('+0.50');
    expect(input(host, 'text').getAttribute('aria-label')).toBe('Exposure value');
    expect(input(host, 'range').getAttribute('aria-label')).toBe('Exposure');
    expect(input(host, 'range').getAttribute('aria-valuetext')).toBe('+0.50 EV');
  });

  it('commits a change once when it is let go, and nothing for a key or press that changed nothing', () => {
    const onCommit = vi.fn();
    const host = mount(<Exposure onCommit={onCommit} />);
    const range = input(host, 'range');
    fire(range, new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
    fire(range, new Event('pointerdown', { bubbles: true }));
    fire(range, new Event('pointerup', { bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();

    fire(range, new Event('pointerdown', { bubbles: true }));
    setRange(range, '1.25');
    setRange(range, '1.5');
    fire(range, new Event('pointerup', { bubbles: true }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(1.5);
    expect(input(host, 'text').value).toBe('+1.50');

    fire(range, new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('takes typed text in the Edit view’s way, minus sign and decimal comma included', () => {
    const onCommit = vi.fn();
    const host = mount(<Exposure onCommit={onCommit} />);
    const box = input(host, 'text');
    act(() => box.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, '−1,5');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fire(box, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCommit).toHaveBeenLastCalledWith(-1.5);
    expect(box.value).toBe('−1.50');
  });

  it('shows a readout of its own when given one', () => {
    const host = mount(<Exposure onCommit={() => undefined} format={(v) => `${Math.round(5000 + v * 1000)} K`} />);
    expect(input(host, 'text').value).toBe('5500 K');
    expect(input(host, 'range').getAttribute('aria-valuetext')).toBe('5500 K');
  });
});
