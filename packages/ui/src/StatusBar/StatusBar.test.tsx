// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBar, StatusDivider, StatusItem, StatusNumber, StatusSpacer } from './StatusBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function show(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('StatusBar', () => {
  it('is a labelled live region by default', () => {
    const el = show(<StatusBar>x</StatusBar>);
    const bar = el.querySelector('footer');
    expect(bar?.getAttribute('role')).toBe('status');
    expect(bar?.getAttribute('aria-label')).toBe('Status bar');
  });

  it('can be a plain labelled bar that does not speak its changes', () => {
    const el = show(<StatusBar label="Photo status" isLive={false}>x</StatusBar>);
    const bar = el.querySelector('footer');
    expect(bar?.hasAttribute('role')).toBe(false);
    expect(bar?.getAttribute('aria-label')).toBe('Photo status');
  });

  it('says what an item is before its value, without showing it', () => {
    const el = show(
      <StatusBar>
        <StatusItem name="Renderer" data-testid="renderer">WebGPU</StatusItem>
        <StatusDivider />
        <StatusSpacer />
        <StatusItem>
          <StatusNumber>10</StatusNumber> photos
        </StatusItem>
      </StatusBar>,
    );
    expect(el.querySelector('[data-testid="renderer"]')?.textContent).toBe('Renderer: WebGPU');
    expect(el.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });
});
