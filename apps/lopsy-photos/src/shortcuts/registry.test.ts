import { describe, expect, it } from 'vitest';
import { formatChord, matchShortcut, SHORTCUTS, shortcutGroups, type KeyInput } from './registry';

function key(k: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('shortcut registry', () => {
  it('maps number keys to ratings in every view', () => {
    expect(matchShortcut(key('0'), 'grid')).toBe('rate-0');
    expect(matchShortcut(key('5'), 'cull')).toBe('rate-5');
  });

  it('matches letters in either case', () => {
    expect(matchShortcut(key('X'), 'grid')).toBe('set-aside');
    expect(matchShortcut(key('r'), 'single')).toBe('label-red');
  });

  it('needs the modifier for select all, and not otherwise', () => {
    expect(matchShortcut(key('a', { metaKey: true }), 'grid')).toBe('select-all');
    expect(matchShortcut(key('a', { ctrlKey: true }), 'grid')).toBe('select-all');
    expect(matchShortcut(key('a'), 'grid')).toBeNull();
    expect(matchShortcut(key('r', { metaKey: true }), 'grid')).toBeNull();
  });

  it('tells arrows from shift-arrows', () => {
    expect(matchShortcut(key('ArrowRight'), 'grid')).toBe('move-right');
    expect(matchShortcut(key('ArrowRight', { shiftKey: true }), 'grid')).toBe('extend-right');
  });

  it('respects the context', () => {
    expect(matchShortcut(key('ArrowUp'), 'single')).toBeNull();
    expect(matchShortcut(key('a', { metaKey: true }), 'cull')).toBeNull();
    expect(matchShortcut(key('Escape'), 'compare')).toBe('back');
  });

  it('ignores alt', () => {
    expect(matchShortcut(key('1', { altKey: true }), 'grid')).toBeNull();
  });

  it('matches ? with or without shift reported', () => {
    expect(matchShortcut(key('?', { shiftKey: true }), 'grid')).toBe('help');
  });

  it('has no two shortcuts on the same chord in the same context', () => {
    const seen = new Set<string>();
    for (const s of SHORTCUTS) {
      for (const c of s.chords) {
        for (const ctx of s.contexts) {
          const k = `${ctx}|${c.key}|${c.mod ?? false}|${c.shift ?? false}`;
          expect(seen.has(k), k).toBe(false);
          seen.add(k);
        }
      }
    }
  });

  it('groups every shortcut for the help popover', () => {
    const total = shortcutGroups().reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(SHORTCUTS.length);
  });

  it('formats chords for people', () => {
    expect(formatChord({ key: 'a', mod: true }, true)).toBe('⌘A');
    expect(formatChord({ key: 'a', mod: true }, false)).toBe('Ctrl+A');
    expect(formatChord({ key: 'ArrowLeft', shift: true }, false)).toBe('Shift+←');
  });
});
