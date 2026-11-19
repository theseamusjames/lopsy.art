// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from '../IconButton/IconButton';
import { Button } from './Button';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(ui));
  return host;
}

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('Button', () => {
  it('stays focusable but does nothing while aria-disabled', () => {
    const onClick = vi.fn();
    const host = mount(
      <Button aria-disabled onClick={onClick}>
        Check library
      </Button>,
    );
    const button = host.querySelector('button');
    button?.focus();
    act(() => button?.click());
    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it('keeps Enter and Space from the page shortcuts, but lets other keys through', () => {
    const pageKeys = vi.fn();
    const onKeyDown = vi.fn();
    window.addEventListener('keydown', pageKeys);
    const host = mount(
      <>
        <Button onKeyDown={onKeyDown}>Export</Button>
        <IconButton label="Keyboard shortcuts" icon={null} />
      </>,
    );
    for (const button of host.querySelectorAll('button')) {
      press(button, 'Enter');
      press(button, ' ');
    }
    expect(pageKeys).not.toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalledTimes(2);
    press(host.querySelector('button') as HTMLElement, 'x');
    expect(pageKeys).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', pageKeys);
  });

  it('says pressed only on a real toggle', () => {
    const host = mount(
      <>
        <IconButton label="More" icon={null} active />
        <IconButton label="Details" icon={null} pressed={false} />
      </>,
    );
    const [more, details] = host.querySelectorAll('button');
    expect(more?.hasAttribute('aria-pressed')).toBe(false);
    expect(details?.getAttribute('aria-pressed')).toBe('false');
  });
});
