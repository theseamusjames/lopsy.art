import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock tool-registry before it can drag in interaction handlers that import WASM.
vi.mock('../../tools/tool-registry', () => ({
  toolRegistry: {
    brush: { id: 'brush', label: 'Brush', shortcut: 'b' },
    eraser: { id: 'eraser', label: 'Eraser', shortcut: 'e' },
    pencil: { id: 'pencil', label: 'Pencil', shortcut: 'n' },
    move: { id: 'move', label: 'Move', shortcut: 'v' },
    fill: { id: 'fill', label: 'Fill', shortcut: 'g' },
    // A tool without a shortcut — should not appear in the map
    gradient: { id: 'gradient', label: 'Gradient' },
  },
  SHORTCUT_TO_TOOL: new Map([
    ['b', 'brush'],
    ['e', 'eraser'],
    ['n', 'pencil'],
    ['v', 'move'],
    ['g', 'fill'],
  ]),
}));

import { useShortcutStore, buildKeyToActionMap, getDefaultKey } from './shortcut-store';

beforeEach(() => {
  useShortcutStore.getState().resetAllShortcuts();
});

describe('shortcut-store', () => {
  describe('getKey', () => {
    it('returns the default key when no custom override exists', () => {
      expect(useShortcutStore.getState().getKey('brush')).toBe('b');
      expect(useShortcutStore.getState().getKey('eraser')).toBe('e');
      expect(useShortcutStore.getState().getKey('swap-colors')).toBe('x');
      expect(useShortcutStore.getState().getKey('reset-colors')).toBe('d');
    });

    it('returns undefined for unknown action IDs', () => {
      expect(useShortcutStore.getState().getKey('nonexistent-action')).toBeUndefined();
    });
  });

  describe('setShortcut', () => {
    it('overrides the default key for an action', () => {
      useShortcutStore.getState().setShortcut('brush', 'q');
      expect(useShortcutStore.getState().getKey('brush')).toBe('q');
    });

    it('lowercases the key', () => {
      useShortcutStore.getState().setShortcut('brush', 'Q');
      expect(useShortcutStore.getState().getKey('brush')).toBe('q');
    });

    it('does not affect other actions', () => {
      useShortcutStore.getState().setShortcut('brush', 'q');
      expect(useShortcutStore.getState().getKey('eraser')).toBe('e');
    });
  });

  describe('resetShortcut', () => {
    it('restores the default key after a custom override', () => {
      useShortcutStore.getState().setShortcut('brush', 'q');
      useShortcutStore.getState().resetShortcut('brush');
      expect(useShortcutStore.getState().getKey('brush')).toBe('b');
    });

    it('is a no-op for actions without a custom override', () => {
      useShortcutStore.getState().resetShortcut('brush');
      expect(useShortcutStore.getState().getKey('brush')).toBe('b');
    });
  });

  describe('resetAllShortcuts', () => {
    it('removes all custom overrides', () => {
      useShortcutStore.getState().setShortcut('brush', 'q');
      useShortcutStore.getState().setShortcut('eraser', 'w');
      useShortcutStore.getState().resetAllShortcuts();
      expect(useShortcutStore.getState().getKey('brush')).toBe('b');
      expect(useShortcutStore.getState().getKey('eraser')).toBe('e');
    });
  });
});

describe('buildKeyToActionMap', () => {
  it('maps defaults when customShortcuts is empty', () => {
    const map = buildKeyToActionMap({});
    expect(map.get('b')).toBe('brush');
    expect(map.get('e')).toBe('eraser');
    expect(map.get('x')).toBe('swap-colors');
    expect(map.get('d')).toBe('reset-colors');
  });

  it('tools without a shortcut are not in the map', () => {
    const map = buildKeyToActionMap({});
    // 'gradient' has no shortcut in the mock
    expect([...map.values()]).not.toContain('gradient');
  });

  it('custom binding shadows the default', () => {
    const map = buildKeyToActionMap({ brush: 'q' });
    expect(map.get('q')).toBe('brush');
    // original default key no longer maps to brush
    expect(map.get('b')).not.toBe('brush');
  });

  it('custom binding evicts the previous owner of the key', () => {
    // 'e' maps to 'eraser' by default; rebind brush to 'e'
    const map = buildKeyToActionMap({ brush: 'e' });
    expect(map.get('e')).toBe('brush');
  });

  it('each custom key maps to exactly one action', () => {
    const map = buildKeyToActionMap({ brush: 'n', pencil: 'b' });
    expect(map.get('n')).toBe('brush');
    expect(map.get('b')).toBe('pencil');
  });

  it('conflict: original action loses its key when another action takes it', () => {
    // pencil → 'n' by default; rebind brush to 'n'
    const map = buildKeyToActionMap({ brush: 'n' });
    expect(map.get('n')).toBe('brush');
  });
});

describe('getDefaultKey', () => {
  it('returns the tool shortcut for tool IDs', () => {
    expect(getDefaultKey('brush')).toBe('b');
    expect(getDefaultKey('move')).toBe('v');
  });

  it('returns undefined for tools without a shortcut', () => {
    expect(getDefaultKey('gradient')).toBeUndefined();
  });

  it('returns the non-tool default for non-tool action IDs', () => {
    expect(getDefaultKey('swap-colors')).toBe('x');
    expect(getDefaultKey('reset-colors')).toBe('d');
  });

  it('returns undefined for unknown IDs', () => {
    expect(getDefaultKey('unknown-action')).toBeUndefined();
  });
});
