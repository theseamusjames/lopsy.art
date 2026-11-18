import { describe, expect, it } from 'vitest';
import { isPreviewStale, isTypingTarget, neighbourId, shortcutFor, type KeyInfo } from './edit-keys';

function key(k: string, mods: Partial<KeyInfo> = {}): KeyInfo {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('shortcutFor', () => {
  it('maps undo and redo on both platforms', () => {
    expect(shortcutFor(key('z', { metaKey: true }))).toBe('undo');
    expect(shortcutFor(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutFor(key('z', { ctrlKey: true }))).toBe('undo');
    expect(shortcutFor(key('y', { ctrlKey: true }))).toBe('redo');
  });

  it('maps zoom and the before view', () => {
    expect(shortcutFor(key('0', { metaKey: true }))).toBe('fit');
    expect(shortcutFor(key('1', { ctrlKey: true }))).toBe('actualSize');
    expect(shortcutFor(key('\\'))).toBe('before');
    expect(shortcutFor(key('ArrowLeft'))).toBe('previous');
    expect(shortcutFor(key('ArrowRight'))).toBe('next');
    expect(shortcutFor(key('ArrowRight', { shiftKey: true }))).toBeNull();
    expect(shortcutFor(key('C', { metaKey: true, shiftKey: true }))).toBe('copyEdits');
    expect(shortcutFor(key('v', { ctrlKey: true, shiftKey: true }))).toBe('pasteEdits');
    expect(shortcutFor(key('c', { metaKey: true }))).toBeNull();
  });

  it('ignores everything else', () => {
    expect(shortcutFor(key('z'))).toBeNull();
    expect(shortcutFor(key('z', { metaKey: true, altKey: true }))).toBeNull();
    expect(shortcutFor(key('a', { metaKey: true }))).toBeNull();
  });
});

describe('isTypingTarget', () => {
  it('is false outside a DOM', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('isPreviewStale', () => {
  it('needs both previews at the edit', () => {
    expect(isPreviewStale({ thumbHash: 'a', screenHash: 'a' }, 'a')).toBe(false);
    expect(isPreviewStale({ thumbHash: 'a', screenHash: null }, 'a')).toBe(true);
    expect(isPreviewStale({ thumbHash: null, screenHash: null }, 'a')).toBe(true);
  });
});

describe('neighbourId', () => {
  it('steps along the filmstrip and stops at the ends', () => {
    expect(neighbourId(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(neighbourId(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(neighbourId(['a'], 'x', 1)).toBeNull();
  });
});
