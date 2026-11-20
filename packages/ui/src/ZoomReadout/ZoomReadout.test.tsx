// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDLES_ARROW_KEYS_ATTR } from '../a11y/arrow-keys';
import { ZoomReadout, scrubbedZoom, steppedZoom, type ZoomReadoutProps } from './ZoomReadout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('scrubbedZoom', () => {
  it('moves 1 % a pixel, right to zoom in and left to zoom out', () => {
    expect(scrubbedZoom(1, 50)).toBeCloseTo(1.5);
    expect(scrubbedZoom(1, -30)).toBeCloseTo(0.7);
  });

  it('stays between 10 % and 400 %, or the bounds given', () => {
    expect(scrubbedZoom(0.5, -100)).toBe(0.1);
    expect(scrubbedZoom(3.9, 50)).toBe(4);
    expect(scrubbedZoom(1, 500, 0.25, 2)).toBe(2);
  });
});

describe('steppedZoom', () => {
  it('goes to the next multiple of 10 % either way', () => {
    expect(steppedZoom(0.46, 1)).toBeCloseTo(0.5);
    expect(steppedZoom(0.46, -1)).toBeCloseTo(0.4);
    expect(steppedZoom(0.5, 1)).toBeCloseTo(0.6);
    expect(steppedZoom(0.5, -1)).toBeCloseTo(0.4);
  });

  it('stays within the bounds', () => {
    expect(steppedZoom(0.1, -1)).toBe(0.1);
    expect(steppedZoom(4, 1)).toBe(4);
  });
});

let root: Root | null = null;

function render(props: Partial<ZoomReadoutProps> = {}) {
  const onZoom = vi.fn();
  const onReset = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<ZoomReadout zoom={0.46} onZoom={onZoom} onReset={onReset} {...props} />));
  const button = host.querySelector('button');
  if (!button) throw new Error('no button');
  return { button, onZoom, onReset };
}

function pointer(target: EventTarget, type: string, clientX: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
}

function click(button: HTMLButtonElement, detail: number): void {
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  });
}

function key(button: HTMLButtonElement, k: string): void {
  act(() => {
    button.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('ZoomReadout', () => {
  it('shows the zoom and is named by it, with how to use it as its description', () => {
    const { button } = render();
    expect(button.textContent).toBe('46%');
    expect(button.getAttribute('aria-label')).toBe('Zoom 46%');
    const hint = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toMatch(/double-click for 100%.*Enter for 100%/);
  });

  it('goes to 100 % on a double-click, or Enter or Space, but not on a single click', () => {
    const { button, onReset } = render();
    click(button, 1);
    expect(onReset).not.toHaveBeenCalled();
    act(() => {
      button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
    // A key press clicks with no pointer: detail 0.
    click(button, 0);
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it('zooms with a drag: right in, left out, 1 % a pixel, after a 2 px dead zone', () => {
    const { button, onZoom } = render();
    pointer(button, 'pointerdown', 100);
    pointer(window, 'pointermove', 101);
    expect(onZoom).not.toHaveBeenCalled();
    pointer(window, 'pointermove', 130);
    expect(onZoom).toHaveBeenLastCalledWith(expect.closeTo(0.76));
    pointer(window, 'pointermove', 80);
    expect(onZoom).toHaveBeenLastCalledWith(expect.closeTo(0.26));
    pointer(window, 'pointerup', 80);
    pointer(window, 'pointermove', 200);
    expect(onZoom).toHaveBeenCalledTimes(2);
  });

  it('does not take a drag and a click for a double-click, in either order', () => {
    const { button, onReset } = render();
    const dblclick = () =>
      act(() => {
        button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });
    // A click, then a press that drags.
    pointer(button, 'pointerdown', 100);
    pointer(window, 'pointerup', 100);
    pointer(button, 'pointerdown', 100);
    pointer(window, 'pointermove', 140);
    pointer(window, 'pointerup', 140);
    dblclick();
    // A drag, then a click.
    pointer(button, 'pointerdown', 100);
    pointer(window, 'pointerup', 100);
    dblclick();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('takes a double-click straight after a drag, however soon', () => {
    const { button, onReset } = render();
    pointer(button, 'pointerdown', 100);
    pointer(window, 'pointermove', 140);
    pointer(window, 'pointerup', 140);
    for (let i = 0; i < 2; i++) {
      pointer(button, 'pointerdown', 140);
      pointer(window, 'pointerup', 140);
    }
    act(() => {
      button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('steps 10 % with the arrow keys and keeps them from the page, whichever phase it listens in', () => {
    const { button, onZoom } = render();
    expect(button.hasAttribute(HANDLES_ARROW_KEYS_ATTR)).toBe(true);
    const onPage = vi.fn();
    document.addEventListener('keydown', onPage);
    key(button, 'ArrowRight');
    expect(onZoom).toHaveBeenLastCalledWith(expect.closeTo(0.5));
    key(button, 'ArrowDown');
    expect(onZoom).toHaveBeenLastCalledWith(expect.closeTo(0.4));
    expect(onPage).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onPage);
  });

  it('does nothing while disabled', () => {
    const { button, onZoom, onReset } = render({ disabled: true });
    expect(button.disabled).toBe(true);
    pointer(button, 'pointerdown', 100);
    pointer(window, 'pointermove', 160);
    expect(onZoom).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });
});
