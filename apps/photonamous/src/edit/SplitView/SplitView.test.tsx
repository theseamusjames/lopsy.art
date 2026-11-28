// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SPLIT_DRAG_SLOP, SplitView } from './SplitView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

/** jsdom has no pointer capture; the divider only asks for it. */
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = () => undefined;
});

/** The split over a 200 px wide image at the stage's left edge, its divider and sides kept here as the Edit view keeps them. */
function Split({ startSwapped = false }: { readonly startSwapped?: boolean }) {
  const [at, setAt] = useState(0.5);
  const [isSwapped, setIsSwapped] = useState(startSwapped);
  return (
    <SplitView
      imageBox={{ left: 0, top: 0, width: 200, height: 100 }}
      beforeSrc="before.jpg"
      at={at}
      onChange={setAt}
      isSwapped={isSwapped}
      onSwap={() => setIsSwapped((v) => !v)}
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

function get(host: HTMLElement, testId: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`no ${testId}`);
  return found;
}

function description(host: HTMLElement): string {
  const id = get(host, 'split-divider').getAttribute('aria-describedby') ?? '';
  return document.getElementById(id)?.textContent ?? '';
}

function pointer(target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number): void {
  const event = new MouseEvent(type, { clientX, clientY: 50, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** A click as the browser sends it, with the pointer moving `jitter` px while pressed. */
function click(target: HTMLElement, x: number, jitter = 0): void {
  pointer(target, 'pointerdown', x);
  if (jitter !== 0) pointer(target, 'pointermove', x + jitter);
  pointer(target, 'pointerup', x + jitter);
}

function doubleClick(target: HTMLElement, x: number, jitter = 0): void {
  click(target, x, jitter);
  click(target, x + jitter, -jitter);
  act(() => {
    target.dispatchEvent(new MouseEvent('dblclick', { clientX: x, bubbles: true, cancelable: true }));
  });
}

function key(target: HTMLElement, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function sides(host: HTMLElement): readonly [string, string, string | null] {
  return [get(host, 'split-label-left').textContent ?? '', get(host, 'split-label-right').textContent ?? '', get(host, 'split-before').dataset.side ?? null];
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('SplitView', () => {
  it('shows before on the left, and says so', () => {
    const host = mount(<Split />);
    const divider = get(host, 'split-divider');
    expect(sides(host)).toEqual(['Before', 'After', 'left']);
    expect(divider.getAttribute('aria-valuetext')).toBe('50 % before, 50 % after');
    expect(description(host)).toBe('Before on the left, after on the right. Double-click or press Enter to swap.');
    expect(divider.title).toBe('Double-click or press Enter to swap before and after');
  });

  it('swaps the sides on a double-click, and back on another', () => {
    const host = mount(<Split />);
    const divider = get(host, 'split-divider');
    doubleClick(divider, 100);
    expect(sides(host)).toEqual(['After', 'Before', 'right']);
    expect(divider.dataset.beforeSide).toBe('right');
    expect(divider.getAttribute('aria-valuetext')).toBe('50 % after, 50 % before');
    expect(description(host)).toBe('After on the left, before on the right. Double-click or press Enter to swap.');
    doubleClick(divider, 100);
    expect(sides(host)).toEqual(['Before', 'After', 'left']);
    expect(divider.getAttribute('aria-valuetext')).toBe('50 % before, 50 % after');
  });

  it('reads each side’s share left first when swapped', () => {
    const host = mount(<Split startSwapped />);
    const divider = get(host, 'split-divider');
    key(divider, 'Home');
    expect(divider.getAttribute('aria-valuetext')).toBe('0 % after, 100 % before');
    key(divider, 'PageUp');
    expect(divider.getAttribute('aria-valuetext')).toBe('10 % after, 90 % before');
  });

  it('leaves the divider where it is on a double-click, pressed off its line and with a jitter', () => {
    const host = mount(<Split />);
    const divider = get(host, 'split-divider');
    // The line is at 100 px; the handle is 24 px wide, so a press 9 px off it is still on the handle.
    doubleClick(divider, 109, SPLIT_DRAG_SLOP);
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    doubleClick(divider, 91, -SPLIT_DRAG_SLOP);
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    expect(sides(host)).toEqual(['Before', 'After', 'left']);
  });

  it('drags as before once the pointer has moved past the slop, right after a swap too', () => {
    const host = mount(<Split />);
    const divider = get(host, 'split-divider');
    doubleClick(divider, 100);
    pointer(divider, 'pointerdown', 100);
    pointer(divider, 'pointermove', 100 + SPLIT_DRAG_SLOP);
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    pointer(divider, 'pointermove', 60);
    expect(divider.getAttribute('aria-valuenow')).toBe('30');
    // Once dragging, it follows the pointer however little it moves.
    pointer(divider, 'pointermove', 62);
    expect(divider.getAttribute('aria-valuenow')).toBe('31');
    pointer(divider, 'pointerup', 62);
    // Moving without a press does nothing.
    pointer(divider, 'pointermove', 150);
    expect(divider.getAttribute('aria-valuenow')).toBe('31');
    expect(sides(host)).toEqual(['After', 'Before', 'right']);
  });

  it('swaps on Enter, once while it is held, and keeps its arrow keys', () => {
    const host = mount(<Split />);
    const divider = get(host, 'split-divider');
    expect(key(divider, 'Enter').defaultPrevented).toBe(true);
    expect(sides(host)).toEqual(['After', 'Before', 'right']);
    key(divider, 'Enter', { repeat: true });
    expect(sides(host)).toEqual(['After', 'Before', 'right']);
    // With a modifier it is not the divider's.
    expect(key(divider, 'Enter', { metaKey: true }).defaultPrevented).toBe(false);
    expect(sides(host)).toEqual(['After', 'Before', 'right']);
    key(divider, 'ArrowLeft');
    expect(divider.getAttribute('aria-valuenow')).toBe('48');
    key(divider, 'Enter');
    expect(sides(host)).toEqual(['Before', 'After', 'left']);
    expect(divider.getAttribute('aria-valuenow')).toBe('48');
  });
});
