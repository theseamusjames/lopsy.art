// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ColorLabel } from '@lopsy/photos-core/library/types';
import { LabelPicker } from './LabelPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(ui: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(ui));
  return host;
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    document.activeElement?.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('LabelPicker', () => {
  it('moves through the colours and No label with the arrow keys', () => {
    const picked: (ColorLabel | null)[] = [];
    function Picker() {
      const [label, setLabel] = useState<ColorLabel | null | undefined>(undefined);
      return (
        <LabelPicker
          value={label}
          onChange={(l) => {
            picked.push(l);
            setLabel(l);
          }}
        />
      );
    }
    const host = mount(<Picker />);
    const first = host.querySelector<HTMLElement>('[tabindex="0"]');
    expect(first?.getAttribute('aria-label')).toBe('Red label');
    first?.focus();
    press('ArrowRight');
    press('End');
    press('ArrowRight');
    expect(picked).toEqual(['yellow', null, 'red']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Red label');
  });
});
