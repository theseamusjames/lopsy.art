// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isClippingKey } from './clipping-warning';
import { isFieldKey } from './edit-keys';

function input(type: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  return el;
}

const plain = { metaKey: false, ctrlKey: false, altKey: false };

describe('isFieldKey', () => {
  it('leaves a slider the keys that move it and gives the view the rest', () => {
    const slider = input('range');
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(isFieldKey(key, slider)).toBe(true);
    }
    for (const key of ['z', 'Escape', 'Enter', 'j', '\\', '?']) expect(isFieldKey(key, slider)).toBe(false);
  });

  it('leaves a text field every key, and takes none from the page', () => {
    expect(isFieldKey('Escape', input('text'))).toBe(true);
    expect(isFieldKey('z', document.createElement('textarea'))).toBe(true);
    expect(isFieldKey('ArrowLeft', document.createElement('div'))).toBe(false);
    expect(isFieldKey('ArrowLeft', null)).toBe(false);
  });
});

describe('isClippingKey', () => {
  it('toggles on J with a slider focused, but not while typing', () => {
    expect(isClippingKey({ key: 'j', ...plain, target: input('range') })).toBe(true);
    expect(isClippingKey({ key: 'j', ...plain, target: input('text') })).toBe(false);
  });
});
