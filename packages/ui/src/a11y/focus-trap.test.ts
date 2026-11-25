// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { nextTabStop, returnFocus, tabStops } from './focus-trap';
import { closeLayer, isTopLayer, isTopModal, openLayer } from './layers';

function dialog(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function names(elements: readonly (HTMLElement | null)[]): string[] {
  return elements.map((el) => el?.getAttribute('data-name') ?? el?.textContent ?? '');
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tabStops', () => {
  it('lists what Tab visits, skipping disabled, hidden, inert and tabindex -1', () => {
    const root = dialog(`
      <button>Close</button>
      <button disabled>Off</button>
      <span tabindex="-1">Roving</span>
      <input data-name="name">
      <input type="hidden" data-name="secret">
      <fieldset disabled><input data-name="fenced"></fieldset>
      <div inert><button>Behind</button></div>
      <a href="#more">More</a>
      <a>No link</a>
      <div tabindex="0">Region</div>
      <select data-name="size"></select>
    `);
    expect(names(tabStops(root))).toEqual(['Close', 'name', 'More', 'Region', 'size']);
  });

  it('stops once per radio group: on the checked radio, else the first', () => {
    const root = dialog(`
      <input type="radio" name="format" data-name="jpeg">
      <input type="radio" name="format" data-name="png" checked>
      <input type="radio" name="depth" data-name="16">
      <input type="radio" name="depth" data-name="8">
      <button>Export</button>
    `);
    expect(names(tabStops(root))).toEqual(['png', '16', 'Export']);
  });
});

describe('nextTabStop', () => {
  const html = '<button>First</button><input data-name="middle"><button>Last</button>';

  it('moves forward and back, wrapping at either end', () => {
    const root = dialog(html);
    const [first, middle, last] = tabStops(root);
    expect(names([nextTabStop(root, first ?? null, false)])).toEqual(['middle']);
    expect(names([nextTabStop(root, middle ?? null, true)])).toEqual(['First']);
    expect(names([nextTabStop(root, last ?? null, false)])).toEqual(['First']);
    expect(names([nextTabStop(root, first ?? null, true)])).toEqual(['Last']);
  });

  it('brings focus from outside to the first stop, or the last going back', () => {
    const root = dialog(html);
    const outside = document.createElement('button');
    document.body.prepend(outside);
    expect(names([nextTabStop(root, outside, false)])).toEqual(['First']);
    expect(names([nextTabStop(root, document.body, true)])).toEqual(['Last']);
    expect(names([nextTabStop(root, null, false)])).toEqual(['First']);
  });

  it('treats any radio of a group as the group', () => {
    const root = dialog(`
      <button>Before</button>
      <input type="radio" name="dest" data-name="library" checked>
      <input type="radio" name="dest" data-name="download">
      <button>After</button>
    `);
    const download = root.querySelector<HTMLElement>('[data-name="download"]');
    expect(names([nextTabStop(root, download, false)])).toEqual(['After']);
  });

  it('is null when nothing in the dialog takes focus', () => {
    expect(nextTabStop(dialog('<p>Only words</p>'), null, false)).toBeNull();
  });
});

describe('returnFocus', () => {
  it('focuses the element from before when focus is inside the closing dialog or nowhere', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const root = dialog('<button>Inside</button>');
    root.querySelector('button')?.focus();
    returnFocus(trigger, root);
    expect(document.activeElement).toBe(trigger);

    (document.activeElement as HTMLElement).blur();
    returnFocus(trigger, root);
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves focus that went somewhere else on purpose', () => {
    const trigger = document.createElement('button');
    const elsewhere = document.createElement('input');
    document.body.append(trigger, elsewhere);
    const root = dialog('<button>Inside</button>');
    elsewhere.focus();
    returnFocus(trigger, root);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('does nothing once the element from before has left the page', () => {
    const trigger = document.createElement('button');
    const root = dialog('<button>Inside</button>');
    root.querySelector('button')?.focus();
    returnFocus(trigger, root);
    expect(document.activeElement?.textContent).toBe('Inside');
  });
});

describe('layers', () => {
  it('gives Escape to the newest layer and Tab to the newest modal', () => {
    const dialogLayer = openLayer(true);
    const popover = openLayer(false);
    expect(isTopLayer(popover)).toBe(true);
    expect(isTopLayer(dialogLayer)).toBe(false);
    expect(isTopModal(dialogLayer)).toBe(true);

    const confirm = openLayer(true);
    expect(isTopModal(confirm)).toBe(true);
    expect(isTopModal(dialogLayer)).toBe(false);

    closeLayer(confirm);
    closeLayer(popover);
    expect(isTopLayer(dialogLayer)).toBe(true);
    closeLayer(dialogLayer);
    expect(isTopModal(dialogLayer)).toBe(false);
  });
});
