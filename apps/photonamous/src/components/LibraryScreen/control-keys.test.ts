// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isControlKey } from './control-keys';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const first = host.firstElementChild;
  if (!first) throw new Error('no element');
  return first;
}

const press = (key: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('isControlKey', () => {
  it('leaves Enter and Space to buttons, links, checkboxes and menu items', () => {
    for (const html of [
      '<button>Set aside</button>',
      '<a href="#photos">Skip</a>',
      '<input type="checkbox">',
      '<span role="button" tabindex="0"></span>',
      '<button role="menuitem">Edit</button>',
      '<button role="radio">3 stars</button>',
      '<summary>More</summary>',
    ]) {
      expect(isControlKey(press('Enter'), el(html))).toBe(true);
      expect(isControlKey(press(' '), el(html))).toBe(true);
    }
  });

  it('leaves the arrows to sliders, radios and menu items but not to buttons', () => {
    expect(isControlKey(press('ArrowRight'), el('<input type="range">'))).toBe(true);
    expect(isControlKey(press('Home'), el('<div role="slider" tabindex="0"></div>'))).toBe(true);
    expect(isControlKey(press('ArrowDown'), el('<button role="menuitem">Edit</button>'))).toBe(true);
    expect(isControlKey(press('ArrowLeft'), el('<input type="radio">'))).toBe(true);
    expect(isControlKey(press('ArrowRight'), el('<button>Compare</button>'))).toBe(false);
  });

  it('keeps every key a shortcut on a photo tile and on the page itself', () => {
    const tile = el('<div role="gridcell" tabindex="0"></div>');
    for (const key of ['Enter', ' ', 'ArrowRight', 'Home']) expect(isControlKey(press(key), tile)).toBe(false);
    expect(isControlKey(press('Enter'), document.body)).toBe(false);
    expect(isControlKey(press('Enter'), null)).toBe(false);
  });

  it('keeps letters, Escape and chords with Ctrl, Cmd or Alt as shortcuts', () => {
    const button = el('<button>Set aside</button>');
    expect(isControlKey(press('x'), button)).toBe(false);
    expect(isControlKey(press('Escape'), button)).toBe(false);
    expect(isControlKey(press(' ', { ctrlKey: true }), button)).toBe(false);
    expect(isControlKey(press('Enter', { metaKey: true }), button)).toBe(false);
  });

  it('treats a link without href and an anchor-less span as nothing', () => {
    expect(isControlKey(press('Enter'), el('<a>plain</a>'))).toBe(false);
    expect(isControlKey(press(' '), el('<span>text</span>'))).toBe(false);
  });
});
