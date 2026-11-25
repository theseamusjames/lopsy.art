// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMenuKeys } from '../a11y/use-menu-keys';
import { Menu, MenuGroup, MenuItem, MenuSeparator } from './Menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function Demo({ onChoose }: { readonly onChoose: (title: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keys = useMenuKeys({ isOpen, onClose: () => setIsOpen(false), onOpen: () => setIsOpen(true), triggerRef });
  const choose = (title: string) => () => {
    setIsOpen(false);
    onChoose(title);
  };
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setIsOpen((o) => !o)} onKeyDown={keys.onTriggerKeyDown}>
        Open
      </button>
      {isOpen && (
        <Menu keys={keys} label="Import photos" id="import-menu" className="placed" note="Or drop them on the window.">
          <MenuItem icon={<svg data-testid="icon" />} detail="Pick one or more files" onSelect={choose('Choose photos')}>
            Choose photos
          </MenuItem>
          <MenuItem disabled onSelect={choose('Add from Drive')}>
            Add from Drive
          </MenuItem>
          <MenuSeparator />
          <MenuGroup label="Yours">
            <MenuItem onSelect={choose('Warm')}>Warm</MenuItem>
          </MenuGroup>
        </Menu>
      )}
    </>
  );
}

function mount(onChoose: (title: string) => void = () => undefined): HTMLButtonElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Demo onChoose={onChoose} />));
  const trigger = host.querySelector('button');
  if (!trigger) throw new Error('no trigger');
  return trigger;
}

function press(key: string): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('Menu', () => {
  it('names the menu, describes it with its note, and groups and separates its items', () => {
    const trigger = mount();
    act(() => trigger.click());
    const list = menu();
    expect(list?.getAttribute('aria-label')).toBe('Import photos');
    expect(list?.id).toBe('import-menu');
    const noteId = list?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(noteId)?.textContent).toBe('Or drop them on the window.');
    expect(list?.parentElement?.classList.contains('placed')).toBe(true);
    expect(items().map((item) => item.textContent)).toEqual(['Choose photosPick one or more files', 'Add from Drive', 'Warm']);
    expect(items().every((item) => item.tabIndex === -1)).toBe(true);
    expect(list?.querySelectorAll('hr')).toHaveLength(1);
    const group = list?.querySelector('[role="group"]');
    expect(document.getElementById(group?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Yours');
    expect(list?.querySelector('[data-testid="icon"]')).not.toBeNull();
  });

  it('takes the keyboard from useMenuKeys: focus on the first item, the arrows, Escape back to the trigger', () => {
    const trigger = mount();
    act(() => trigger.focus());
    press('ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    press('End');
    expect(document.activeElement?.textContent).toBe('Warm');
    press('Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('chooses an item on click, but not a disabled one', () => {
    const onChoose = vi.fn();
    const trigger = mount(onChoose);
    act(() => trigger.click());
    const disabled = items()[1];
    expect(disabled?.getAttribute('aria-disabled')).toBe('true');
    act(() => disabled?.click());
    expect(onChoose).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
    act(() => items()[0]?.click());
    expect(onChoose).toHaveBeenCalledWith('Choose photos');
    expect(menu()).toBeNull();
  });
});
