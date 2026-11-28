// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: React.ReactNode): HTMLButtonElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(ui));
  const button = host.querySelector('button');
  if (!button) throw new Error('no button');
  return button;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const REASON = 'This photo is 17504 × 3440 pixels, larger than Lopsy can open on this device (16382 on a side).';

describe('IconButton', () => {
  it('is named and titled by its label', () => {
    const button = mount(<IconButton label="Edit in Lopsy" icon={null} />);
    expect(button.getAttribute('aria-label')).toBe('Edit in Lopsy');
    expect(button.title).toBe('Edit in Lopsy');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('when unavailable, says why in its tooltip and description, stays focusable and does nothing', () => {
    const onClick = vi.fn();
    const button = mount(<IconButton label="Edit in Lopsy" icon={null} unavailable={REASON} onClick={onClick} />);
    expect(button.getAttribute('aria-label')).toBe('Edit in Lopsy');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    expect(button.title).toBe(REASON);
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(REASON);

    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('when unavailable, tells onUnavailablePress of a press, and not onClick', () => {
    const onClick = vi.fn();
    const onUnavailablePress = vi.fn();
    const button = mount(<IconButton label="Edit in Lopsy" icon={null} unavailable={REASON} onClick={onClick} onUnavailablePress={onUnavailablePress} />);
    act(() => button.click());
    expect(onUnavailablePress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
