import { describe, expect, it } from 'vitest';
import { PAN_LARGE_STEP, PAN_STEP, ZOOM_STEP, isPreviewStale, isTypingTarget, neighbourId, shortcutFor, splitAfterKey, splitValueText, stageKeyAction, type KeyInfo } from './edit-keys';

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
    expect(shortcutFor(key('Escape'))).toBe('leave');
    expect(shortcutFor(key('r'))).toBe('crop');
    expect(shortcutFor(key('m'))).toBe('linearArea');
    expect(shortcutFor(key('M', { shiftKey: true }))).toBe('radialArea');
    expect(shortcutFor(key('o'))).toBe('showMask');
    expect(shortcutFor(key('O', { shiftKey: true }))).toBeNull();
    expect(shortcutFor(key('o', { metaKey: true }))).toBeNull();
    expect(shortcutFor(key('r', { altKey: true }))).toBeNull();
    expect(shortcutFor(key('?', { shiftKey: true }))).toBe('help');
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

describe('splitAfterKey', () => {
  it('steps, pages and jumps to the edges', () => {
    expect(splitAfterKey(0.5, 'ArrowRight', false)).toBeCloseTo(0.52);
    expect(splitAfterKey(0.5, 'ArrowLeft', true)).toBeCloseTo(0.4);
    expect(splitAfterKey(0.5, 'PageUp', false)).toBeCloseTo(0.6);
    expect(splitAfterKey(0.5, 'Home', false)).toBe(0);
    expect(splitAfterKey(0.5, 'End', false)).toBe(1);
  });

  it('stays on the photo and leaves other keys alone', () => {
    expect(splitAfterKey(0.99, 'ArrowRight', true)).toBe(1);
    expect(splitAfterKey(0.01, 'PageDown', false)).toBe(0);
    expect(splitAfterKey(0.5, 'Enter', false)).toBeNull();
  });

  it('reads both sides', () => {
    expect(splitValueText(0.3)).toBe('30 % before, 70 % after');
  });
});

describe('stageKeyAction', () => {
  it('pans the view as scrolling does, further with Shift', () => {
    expect(stageKeyAction(key('ArrowRight'))).toEqual({ kind: 'pan', dx: -PAN_STEP, dy: 0 });
    expect(stageKeyAction(key('ArrowUp', { shiftKey: true }))).toEqual({ kind: 'pan', dx: 0, dy: PAN_LARGE_STEP });
  });

  it('zooms with + and −, whether or not Shift makes them', () => {
    expect(stageKeyAction(key('+', { shiftKey: true }))).toEqual({ kind: 'zoom', factor: ZOOM_STEP });
    expect(stageKeyAction(key('='))).toEqual({ kind: 'zoom', factor: ZOOM_STEP });
    expect(stageKeyAction(key('-'))).toEqual({ kind: 'zoom', factor: 1 / ZOOM_STEP });
  });

  it('leaves shortcuts and other keys to the view', () => {
    expect(stageKeyAction(key('ArrowRight', { metaKey: true }))).toBeNull();
    expect(stageKeyAction(key('=', { ctrlKey: true }))).toBeNull();
    expect(stageKeyAction(key('r'))).toBeNull();
  });
});
