// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditToolbar, type EditToolbarAction } from './EditToolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mountAction(action: EditToolbarAction): HTMLButtonElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<EditToolbar tools={[]} activeId={null} onSelect={() => undefined} actions={[action]} />));
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
const lopsy = (extra: Partial<EditToolbarAction>, onClick = vi.fn()): EditToolbarAction => ({
  id: 'lopsy',
  label: 'Edit in Lopsy',
  title: 'Edit in Lopsy, with layers, painting and text',
  icon: null,
  onClick,
  ...extra,
});

describe('EditToolbar actions', () => {
  it('run when pressed, titled by their title', () => {
    const onClick = vi.fn();
    const button = mountAction(lopsy({}, onClick));
    expect(button.title).toBe('Edit in Lopsy, with layers, painting and text');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    act(() => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('when unavailable, say why in the tooltip and description, stay focusable and do nothing', () => {
    const onClick = vi.fn();
    const button = mountAction(lopsy({ unavailable: REASON }, onClick));
    expect(button.getAttribute('aria-label')).toBe('Edit in Lopsy');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    expect(button.title).toBe(REASON);
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe(REASON);
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('when unavailable, tell onUnavailablePress of a press, and not onClick', () => {
    const onClick = vi.fn();
    const onUnavailablePress = vi.fn();
    const button = mountAction(lopsy({ unavailable: REASON, onUnavailablePress }, onClick));
    act(() => button.click());
    expect(onUnavailablePress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
