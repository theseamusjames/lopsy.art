import { describe, expect, it } from 'vitest';
import { blocksShortcut, isCharacterKey, parseCharacterKeysEnabled } from './character-keys';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  ...mods,
});

describe('character key shortcuts', () => {
  it('are one letter, digit, punctuation mark or symbol, without Ctrl, Cmd or Alt', () => {
    for (const k of ['3', 'x', 'X', 'r', 'j', '?', '\\', '[']) expect(isCharacterKey(key(k))).toBe(true);
    for (const k of ['Enter', 'Escape', 'ArrowLeft', 'Delete', 'Backspace', 'Tab', ' ', 'F1']) expect(isCharacterKey(key(k))).toBe(false);
    expect(isCharacterKey(key('z', { ctrlKey: true }))).toBe(false);
    expect(isCharacterKey(key('z', { metaKey: true }))).toBe(false);
    expect(isCharacterKey(key('m', { altKey: true }))).toBe(false);
  });

  it('are on unless turned off', () => {
    expect(parseCharacterKeysEnabled(null)).toBe(true);
    expect(parseCharacterKeysEnabled('on')).toBe(true);
    expect(parseCharacterKeysEnabled('garbage')).toBe(true);
    expect(parseCharacterKeysEnabled('off')).toBe(false);
  });

  it('are kept from the handlers only while turned off', () => {
    expect(blocksShortcut(key('3'), true)).toBe(false);
    expect(blocksShortcut(key('3'), false)).toBe(true);
    expect(blocksShortcut(key('z', { ctrlKey: true }), false)).toBe(false);
    expect(blocksShortcut(key('ArrowRight'), false)).toBe(false);
  });
});
