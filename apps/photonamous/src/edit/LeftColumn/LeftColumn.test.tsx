// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeftColumn, type LeftColumnSection } from './LeftColumn';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SECTIONS: LeftColumnSection[] = [
  { id: 'presets', title: 'Presets', icon: <i>p</i>, content: <p>the presets</p> },
  { id: 'history', title: 'History', icon: <i>h</i>, content: <p>the history</p> },
];

/** The column with the Edit view's part of it: the button that folds it. */
function Harness() {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setIsOpen((v) => !v)}>
        fold
      </button>
      <LeftColumn sections={SECTIONS} isOpen={isOpen} onOpen={() => setIsOpen(true)} />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = () => undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name) ?? null;
const click = (name: string) => act(() => button(name)?.click());

describe('LeftColumn', () => {
  it('folds into a strip with a button for each section', () => {
    expect(host.textContent).toContain('the presets');
    click('fold');
    expect(host.textContent).not.toContain('the presets');
    expect(button('Show Presets')).not.toBeNull();
    expect(button('Show History')).not.toBeNull();
  });

  it('a strip button opens the column with its section unfolded and focus on its heading', () => {
    // History folded away before the column is.
    click('History');
    expect(button('History')?.getAttribute('aria-expanded')).toBe('false');
    click('fold');
    click('Show History');
    expect(button('Show History')).toBeNull();
    expect(button('History')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button('History'));
    // The other section is as it was left.
    expect(button('Presets')?.getAttribute('aria-expanded')).toBe('true');
  });
});
