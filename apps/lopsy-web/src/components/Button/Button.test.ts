// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Button } from './Button';

function renderToContainer(el: React.ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(el); });
  return container;
}

describe('Button', () => {
  it('renders children', () => {
    const c = renderToContainer(createElement(Button, null, 'Click me'));
    const btn = c.querySelector('button')!;
    expect(btn.textContent).toBe('Click me');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const c = renderToContainer(createElement(Button, { onClick }, 'Go'));
    act(() => { c.querySelector('button')!.click(); });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('defaults to type="button"', () => {
    const c = renderToContainer(createElement(Button, null, 'Go'));
    expect(c.querySelector('button')!.getAttribute('type')).toBe('button');
  });
});
