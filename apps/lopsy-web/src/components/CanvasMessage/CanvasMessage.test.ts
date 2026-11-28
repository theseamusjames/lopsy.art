// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanvasMessage } from './CanvasMessage';
import { useCanvasMessageStore } from '../../app/canvas-message-store';
import { useEditorStore } from '../../app/editor-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

const TEXT = { title: 'This image is too large to open', body: 'ultrawide.jpg is 17,504 × 3,440 pixels.' };

function show(): void {
  act(() => useCanvasMessageStore.getState().show({ ...TEXT, documentVersion: useEditorStore.getState().documentVersion }));
}

function dialog(): HTMLElement | null {
  return host.querySelector('[role="alertdialog"]');
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(CanvasMessage)));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  useCanvasMessageStore.getState().dismiss();
});

describe('CanvasMessage', () => {
  it('shows nothing until there is a message', () => {
    expect(dialog()).toBeNull();
  });

  it('is an alert dialog named by its heading and described by its words, and takes focus', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    show();
    const shown = dialog();
    expect(shown).not.toBeNull();
    expect(document.getElementById(shown?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(TEXT.title);
    expect(document.getElementById(shown?.getAttribute('aria-describedby') ?? '')?.textContent).toBe(TEXT.body);
    expect(shown?.getAttribute('aria-modal')).toBe('false');
    expect(document.activeElement?.textContent).toBe('OK');
  });

  it('OK dismisses it and gives focus back', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    show();
    const ok = dialog()?.querySelector('button');
    act(() => ok?.click());
    expect(dialog()).toBeNull();
    expect(useCanvasMessageStore.getState().message).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Escape dismisses it, and the key goes no further', () => {
    show();
    let reachedWindow = false;
    const onWindowKey = () => {
      reachedWindow = true;
    };
    window.addEventListener('keydown', onWindowKey);
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    window.removeEventListener('keydown', onWindowKey);
    expect(dialog()).toBeNull();
    expect(reachedWindow).toBe(false);
  });

  it('goes when another document opens', () => {
    show();
    act(() => useEditorStore.setState((s) => ({ documentVersion: s.documentVersion + 1 })));
    expect(dialog()).toBeNull();
    expect(useCanvasMessageStore.getState().message).toBeNull();
  });
});
