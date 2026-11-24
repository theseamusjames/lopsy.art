// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorField, type ColorFieldProps } from './ColorField';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

/** The field over a colour kept here, as the Edit view keeps it. */
function Field(props: Partial<ColorFieldProps>) {
  const [color, setColor] = useState({ hue: 200, saturation: 40 });
  return (
    <ColorField
      label="Shadows color"
      hue={color.hue}
      saturation={color.saturation}
      onChange={(hue, saturation) => setColor({ hue, saturation })}
      onCommit={() => undefined}
      {...props}
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

function field(host: HTMLElement): HTMLElement {
  const found = host.querySelector<HTMLElement>('[role="slider"]');
  if (!found) throw new Error('no field');
  return found;
}

function key(target: HTMLElement, type: 'keydown' | 'keyup', name: string, shiftKey = false, altKey = false): KeyboardEvent {
  const event = new KeyboardEvent(type, { key: name, shiftKey, altKey, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('ColorField', () => {
  it('is named, and says its hue and saturation', () => {
    const el = field(mount(<Field />));
    expect(el.getAttribute('aria-label')).toBe('Shadows color');
    expect(el.getAttribute('aria-valuetext')).toBe('Hue 200°, saturation 40 %');
    expect(el.tabIndex).toBe(0);
  });

  it('moves with the arrow keys, ten at a time with Shift, and commits once the key is let go', () => {
    const onCommit = vi.fn();
    const el = field(mount(<Field onCommit={onCommit} />));
    expect(key(el, 'keydown', 'ArrowRight').defaultPrevented).toBe(true);
    key(el, 'keydown', 'ArrowRight');
    expect(el.getAttribute('aria-valuetext')).toBe('Hue 202°, saturation 40 %');
    expect(onCommit).not.toHaveBeenCalled();
    key(el, 'keyup', 'ArrowRight');
    expect(onCommit).toHaveBeenCalledWith(202, 40);

    key(el, 'keydown', 'ArrowUp', true);
    key(el, 'keyup', 'ArrowUp', true);
    expect(onCommit).toHaveBeenLastCalledWith(202, 50);
    // Alt is the fine step, a tenth.
    key(el, 'keydown', 'ArrowLeft', false, true);
    key(el, 'keyup', 'ArrowLeft', false, true);
    expect(onCommit).toHaveBeenLastCalledWith(201.9, 50);
    expect(el.getAttribute('aria-valuetext')).toBe('Hue 201.9°, saturation 50 %');
    // A key that moves nothing commits nothing.
    expect(key(el, 'keydown', 'a').defaultPrevented).toBe(false);
    key(el, 'keyup', 'a');
    expect(onCommit).toHaveBeenCalledTimes(3);
  });

  it('is enlarged by its button, with focus on the field, and put back by Escape, a click elsewhere or the wheel', () => {
    const host = mount(<Field />);
    const el = field(host);
    const enlarge = host.querySelector<HTMLButtonElement>('button');
    if (!enlarge) throw new Error('no button');
    expect(enlarge.getAttribute('aria-label')).toBe('Enlarge Shadows color');
    expect(enlarge.getAttribute('aria-expanded')).toBe('false');

    act(() => enlarge.click());
    expect(enlarge.getAttribute('aria-expanded')).toBe('true');
    expect(el.hasAttribute('data-expanded')).toBe(true);
    expect(document.activeElement).toBe(el);
    // Its own Escape: the view must not take it as Back.
    expect(key(el, 'keydown', 'Escape').defaultPrevented).toBe(true);
    expect(el.hasAttribute('data-expanded')).toBe(false);
    expect(key(el, 'keydown', 'Escape').defaultPrevented).toBe(false);

    act(() => enlarge.click());
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(el.hasAttribute('data-expanded')).toBe(false);

    act(() => enlarge.click());
    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });
    expect(el.hasAttribute('data-expanded')).toBe(false);
  });

  it('shows the colour under the pointer in a ring, and none once the pointer has left', () => {
    const host = mount(<Field />);
    const el = field(host);
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 200, right: 210, bottom: 220, x: 10, y: 20, toJSON: () => ({}) });
    const ring = () => host.querySelector<HTMLElement>('[data-testid="color-pointer"]');
    const slot = el.parentElement;
    expect(ring()).toBeNull();

    // Half way across is hue 180; a quarter of the way down is saturation 75.
    act(() => {
      el.dispatchEvent(new MouseEvent('pointermove', { clientX: 110, clientY: 70, bubbles: true }));
    });
    expect(ring()).not.toBeNull();
    expect(slot?.style.getPropertyValue('--hover-color')).toBe('hsl(180 100% 62.5%)');
    expect(slot?.style.getPropertyValue('--hover-x')).toBe('0.5');
    expect(slot?.style.getPropertyValue('--hover-y')).toBe('0.25');
    // Looking is not picking: the colour itself has not moved.
    expect(el.getAttribute('aria-valuetext')).toBe('Hue 200°, saturation 40 %');

    act(() => {
      el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(ring()).toBeNull();
  });

  it('holds still while it is disabled', () => {
    const onChange = vi.fn();
    const host = mount(<Field isDisabled onChange={onChange} />);
    const el = field(host);
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.tabIndex).toBe(-1);
    key(el, 'keydown', 'ArrowRight');
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('button')?.disabled).toBe(true);
    act(() => {
      el.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5, bubbles: true }));
    });
    expect(host.querySelector('[data-testid="color-pointer"]')).toBeNull();
  });
});
