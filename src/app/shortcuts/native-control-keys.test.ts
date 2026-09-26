// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isNativeArrowKeyTarget } from './native-control-keys';

function input(type: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  return el;
}

describe('isNativeArrowKeyTarget (#897)', () => {
  it('defers to a range input for arrow keys', () => {
    const el = input('range');
    expect(isNativeArrowKeyTarget(el, 'ArrowLeft')).toBe(true);
    expect(isNativeArrowKeyTarget(el, 'ArrowRight')).toBe(true);
    expect(isNativeArrowKeyTarget(el, 'ArrowUp')).toBe(true);
    expect(isNativeArrowKeyTarget(el, 'ArrowDown')).toBe(true);
  });

  it('defers to a radio input for arrow keys', () => {
    const el = input('radio');
    expect(isNativeArrowKeyTarget(el, 'ArrowLeft')).toBe(true);
  });

  it('defers to a select element for arrow keys', () => {
    const el = document.createElement('select');
    expect(isNativeArrowKeyTarget(el, 'ArrowDown')).toBe(true);
  });

  it('does not defer for a text-entry input', () => {
    expect(isNativeArrowKeyTarget(input('text'), 'ArrowLeft')).toBe(false);
    expect(isNativeArrowKeyTarget(input('number'), 'ArrowLeft')).toBe(false);
  });

  it('does not defer for a checkbox input (no native arrow-key behavior)', () => {
    expect(isNativeArrowKeyTarget(input('checkbox'), 'ArrowLeft')).toBe(false);
  });

  it('does not defer for a plain element or null target', () => {
    expect(isNativeArrowKeyTarget(document.createElement('div'), 'ArrowLeft')).toBe(false);
    expect(isNativeArrowKeyTarget(null, 'ArrowLeft')).toBe(false);
  });

  it('does not defer for non-arrow keys, even on a range input', () => {
    const el = input('range');
    expect(isNativeArrowKeyTarget(el, 'a')).toBe(false);
    expect(isNativeArrowKeyTarget(el, 'z')).toBe(false);
    expect(isNativeArrowKeyTarget(el, 'Home')).toBe(false);
  });
});
