// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Rating } from '@lopsy/photos-core/library/types';
import { Stars } from './Stars';

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
