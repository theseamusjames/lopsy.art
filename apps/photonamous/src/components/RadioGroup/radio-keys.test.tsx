// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColorLabel, Rating } from '@lopsy/photos-core/library/types';
import { LabelPicker } from '../LabelPicker/LabelPicker';
import { Stars } from '../Stars/Stars';
import { radioMove, radioTabIndex } from './radio-keys';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('radioMove', () => {
  it('moves with the arrows, wrapping, and to the ends with Home and End', () => {
    expect(radioMove('ArrowRight', 1, 5)).toBe(2);
    expect(radioMove('ArrowDown', 4, 5)).toBe(0);
    expect(radioMove('ArrowLeft', 0, 5)).toBe(4);
    expect(radioMove('ArrowUp', 3, 5)).toBe(2);
    expect(radioMove('Home', 3, 5)).toBe(0);
    expect(radioMove('End', 1, 5)).toBe(4);
  });

  it('ignores other keys, and a group without focus', () => {
    expect(radioMove('a', 1, 5)).toBeNull();
    expect(radioMove('ArrowRight', -1, 5)).toBeNull();
  });
});

describe('radioTabIndex', () => {
  it('makes the checked radio the one Tab stop, or the first when none is checked', () => {
    expect([0, 1, 2].map((i) => radioTabIndex(i, 1))).toEqual([-1, 0, -1]);
    expect([0, 1, 2].map((i) => radioTabIndex(i, -1))).toEqual([0, -1, -1]);
  });
});

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

function Rated({ onRate }: { onRate: (rating: Rating) => void }) {
  const [rating, setRating] = useState<Rating>(3);
  return (
    <Stars
      rating={rating}
      onChange={(r) => {
        setRating(r);
        onRate(r);
      }}
    />
  );
}

describe('Stars', () => {
  it('is one Tab stop, and the arrow keys choose the rating without reaching the page', () => {
    const onRate = vi.fn();
    const pageKeys = vi.fn();
    window.addEventListener('keydown', pageKeys);
    const host = mount(<Rated onRate={onRate} />);
    const stops = [...host.querySelectorAll('[role="radio"]')].map((r) => (r as HTMLElement).tabIndex);
    expect(stops).toEqual([-1, -1, 0, -1, -1]);

    (host.querySelector('[aria-checked="true"]') as HTMLElement).focus();
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(onRate).toHaveBeenLastCalledWith(4);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('4 stars');
    expect(host.querySelector('[aria-checked="true"]')?.getAttribute('aria-label')).toBe('4 stars');
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');

    press('Home');
    expect(onRate).toHaveBeenLastCalledWith(1);
    press('ArrowLeft');
    expect(onRate).toHaveBeenLastCalledWith(5);
    press(' ');
    expect(pageKeys).not.toHaveBeenCalled();
    window.removeEventListener('keydown', pageKeys);
  });

  it('names the read-only rating as one image', () => {
    const host = mount(<Stars rating={2} />);
    const stars = host.querySelector('[role="img"]');
    expect(stars?.getAttribute('aria-label')).toBe('2 stars');
  });
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
