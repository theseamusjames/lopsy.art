// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from '../Popover/Popover';
import { Modal } from './Modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(ui));
  return host;
}

function press(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

function focused(): string {
  return document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '';
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function Dialogs() {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open
      </button>
      {isOpen && (
        <Modal title="Settings" onClose={() => setIsOpen(false)} footer={<button type="button">Done</button>}>
          <input aria-label="Name" />
          <button type="button" onClick={() => setIsConfirming(true)}>
            Share
          </button>
          {isConfirming && (
            <Modal title="Share this?" onClose={() => setIsConfirming(false)}>
              <button type="button" data-autofocus>
                Share it
              </button>
            </Modal>
          )}
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  it('takes focus, keeps Tab inside, and gives focus back on Escape', () => {
    const host = mount(<Dialogs />);
    const open = host.querySelector('button');
    open?.focus();
    act(() => open?.click());
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Settings');
    expect(focused()).toBe('Name');

    press('Tab');
    expect(focused()).toBe('Share');
    press('Tab');
    expect(focused()).toBe('Done');
    press('Tab');
    expect(focused()).toBe('Close');
    press('Tab', { shiftKey: true });
    expect(focused()).toBe('Done');

    press('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('brings Tab back in when focus has fallen to the page', () => {
    const host = mount(<Dialogs />);
    act(() => host.querySelector('button')?.click());
    (document.activeElement as HTMLElement).blur();
    press('Tab');
    expect(focused()).toBe('Close');
  });

  it('closes only the topmost dialog on Escape, and its keys never reach the page', () => {
    const host = mount(<Dialogs />);
    const pageKeys = vi.fn();
    window.addEventListener('keydown', pageKeys);
    act(() => host.querySelector('button')?.click());
    const share = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Share');
    share?.focus();
    act(() => share?.click());
    expect(focused()).toBe('Share it');

    press('Tab');
    expect(focused()).toBe('Close');
    press('Tab');
    expect(focused()).toBe('Share it');

    press('Escape');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(focused()).toBe('Share');
    press('Enter');
    press('x');
    expect(pageKeys).not.toHaveBeenCalled();

    // The same keys from the page itself reach its shortcuts once the dialog is gone.
    press('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    press('x');
    expect(pageKeys).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', pageKeys);
  });
});

function Anchored() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <div>
        <button type="button" aria-expanded={isOpen} onClick={() => setIsOpen((o) => !o)}>
          Saved
        </button>
        {isOpen && (
          <Popover label="Saving and storage" onClose={() => setIsOpen(false)}>
            <button type="button">Save now</button>
            <button type="button">Pause</button>
          </Popover>
        )}
      </div>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe('Popover', () => {
  it('moves focus in on open and back to the trigger on Escape', () => {
    const host = mount(<Anchored />);
    const trigger = host.querySelector('button');
    trigger?.focus();
    act(() => trigger?.click());
    expect(focused()).toBe('Save now');
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(false);
    press('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the arrow and Enter keys from the page shortcuts, and closes when focus moves out', () => {
    const host = mount(<Anchored />);
    const pageKeys = vi.fn();
    window.addEventListener('keydown', pageKeys);
    act(() => host.querySelector('button')?.click());
    press('ArrowDown');
    press('Enter');
    expect(pageKeys).not.toHaveBeenCalled();
    // Letter shortcuts still reach the page while the popover is open.
    press('x');
    expect(pageKeys).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', pageKeys);

    const elsewhere = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Elsewhere');
    act(() => elsewhere?.focus());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('leaves focus alone when closed by a click elsewhere', () => {
    const host = mount(<Anchored />);
    const trigger = host.querySelector('button');
    trigger?.focus();
    act(() => trigger?.click());
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });
});
