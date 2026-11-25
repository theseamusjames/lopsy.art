// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { menuMove, useMenuKeys } from './use-menu-keys';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('menuMove', () => {
  const labels = ['New version', 'Edit in Lopsy', 'Group bursts', 'Show set aside'];

  it('steps with the arrows, wrapping at both ends', () => {
    expect(menuMove('ArrowDown', 0, labels)).toBe(1);
    expect(menuMove('ArrowDown', 3, labels)).toBe(0);
    expect(menuMove('ArrowUp', 0, labels)).toBe(3);
    expect(menuMove('ArrowUp', 2, labels)).toBe(1);
  });

  it('starts at either end when nothing has focus yet', () => {
    expect(menuMove('ArrowDown', -1, labels)).toBe(0);
    expect(menuMove('ArrowUp', -1, labels)).toBe(3);
  });

  it('goes to the first and last with Home and End', () => {
    expect(menuMove('Home', 2, labels)).toBe(0);
    expect(menuMove('End', 1, labels)).toBe(3);
  });

  it('jumps to the next item starting with a typed letter', () => {
    expect(menuMove('s', 0, labels)).toBe(3);
    expect(menuMove('E', 3, labels)).toBe(1);
    expect(menuMove('n', 0, labels)).toBe(0);
    expect(menuMove('z', 0, labels)).toBeNull();
  });

  it('leaves other keys and empty menus alone', () => {
    expect(menuMove('Enter', 0, labels)).toBeNull();
    expect(menuMove(' ', 0, labels)).toBeNull();
    expect(menuMove('ArrowDown', -1, [])).toBeNull();
  });
});

let root: Root | null = null;

function MenuButton({ onRun }: { onRun: (label: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, onMenuKeyDown, onTriggerKeyDown } = useMenuKeys({
    isOpen,
    onClose: () => setIsOpen(false),
    onOpen: () => setIsOpen(true),
    triggerRef,
  });
  const item = (label: string, isDisabled = false) => (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={isDisabled || undefined}
      onClick={() => {
        if (isDisabled) return;
        setIsOpen(false);
        onRun(label);
      }}
    >
      {label}
    </button>
  );
  return (
    <>
      <button ref={triggerRef} type="button" aria-expanded={isOpen} onClick={() => setIsOpen((o) => !o)} onKeyDown={onTriggerKeyDown}>
        More
      </button>
      {isOpen && (
        <div ref={menuRef} role="menu" tabIndex={-1} onKeyDown={onMenuKeyDown}>
          {item('New version')}
          {item('Edit in Lopsy', true)}
          {item('Group bursts')}
        </div>
      )}
      <button type="button">After</button>
    </>
  );
}

function mount(onRun: (label: string) => void = () => undefined): HTMLButtonElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<MenuButton onRun={onRun} />));
  const trigger = host.querySelector('button');
  if (!trigger) throw new Error('no trigger');
  return trigger;
}

function press(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

function open(trigger: HTMLButtonElement): void {
  trigger.focus();
  act(() => trigger.click());
}

const focused = () => document.activeElement?.textContent ?? '';
const isOpen = () => document.querySelector('[role="menu"]') !== null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('useMenuKeys', () => {
  it('focuses the first item, moves with the arrows, Home and End, and wraps', () => {
    const trigger = mount();
    open(trigger);
    expect(focused()).toBe('New version');
    press('ArrowDown');
    expect(focused()).toBe('Edit in Lopsy');
    press('ArrowDown');
    press('ArrowDown');
    expect(focused()).toBe('New version');
    press('ArrowUp');
    expect(focused()).toBe('Group bursts');
    press('Home');
    expect(focused()).toBe('New version');
    press('End');
    expect(focused()).toBe('Group bursts');
    press('e');
    expect(focused()).toBe('Edit in Lopsy');
  });

  it('closes on Escape with focus back on the trigger', () => {
    const trigger = mount();
    open(trigger);
    press('ArrowDown');
    const event = press('Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Tab from the trigger, letting the browser move on', () => {
    const trigger = mount();
    open(trigger);
    const event = press('Tab');
    expect(event.defaultPrevented).toBe(false);
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not choose a disabled item, and leaves Enter on the others to the button', () => {
    const onRun = vi.fn();
    const trigger = mount(onRun);
    open(trigger);
    expect(press('Enter').defaultPrevented).toBe(false);
    press('ArrowDown');
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(press(' ').defaultPrevented).toBe(true);
    expect(onRun).not.toHaveBeenCalled();
    expect(isOpen()).toBe(true);
  });

  it('gives focus back to the trigger after an item runs', () => {
    const onRun = vi.fn();
    const trigger = mount(onRun);
    open(trigger);
    act(() => (document.activeElement as HTMLElement).click());
    expect(onRun).toHaveBeenCalledWith('New version');
    expect(document.activeElement).toBe(trigger);
  });

  it('opens from the trigger with ArrowDown (first item) and ArrowUp (last item)', () => {
    const trigger = mount();
    trigger.focus();
    press('ArrowDown');
    expect(focused()).toBe('New version');
    press('Escape');
    press('ArrowUp');
    expect(focused()).toBe('Group bursts');
  });

  it('keeps its keys from the page, but not shortcuts with a modifier', () => {
    const pageKeys = vi.fn();
    window.addEventListener('keydown', pageKeys);
    const trigger = mount();
    open(trigger);
    press('ArrowDown');
    press('x');
    press('Enter');
    expect(pageKeys).not.toHaveBeenCalled();
    press('z', { ctrlKey: true });
    expect(pageKeys).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', pageKeys);
  });

  it('closes on a click outside and leaves focus where the click put it', () => {
    const trigger = mount();
    open(trigger);
    const after = [...document.querySelectorAll('button')].find((b) => b.textContent === 'After');
    act(() => {
      after?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      after?.focus();
    });
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(after);
  });
});
