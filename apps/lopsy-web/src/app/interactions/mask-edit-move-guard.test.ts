// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../test/canvas-mock';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const { useUIStore } = await import('../ui-store');
const { useEditorStore } = await import('../editor-store');
const { isMaskEditSelectionMove, maskEditSelectionMoveRefusal, refuseMaskEditSelectionMove } = await import('./mask-edit-move-guard');
const { useNotificationsStore } = await import('../notifications-store');
const { EMPTY_SELECTION } = await import('../store/types');

function setSelectionActive(isActive: boolean): void {
  useEditorStore.setState({
    selection: isActive
      ? { active: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, mask: new Uint8ClampedArray(1), maskWidth: 1, maskHeight: 1 }
      : EMPTY_SELECTION,
  });
}

describe('isMaskEditSelectionMove (#1407)', () => {
  beforeEach(() => {
    useUIStore.setState({ activeTool: 'move', maskMode: 'layerMask' });
    setSelectionActive(true);
  });

  it('is true for a Move with a selection in layer-mask edit mode', () => {
    expect(isMaskEditSelectionMove()).toBe(true);
  });

  it('is false without a selection — a whole-layer move carries the mask along', () => {
    setSelectionActive(false);
    expect(isMaskEditSelectionMove()).toBe(false);
  });

  it('is false outside layer-mask edit mode', () => {
    useUIStore.setState({ maskMode: 'off' });
    expect(isMaskEditSelectionMove()).toBe(false);
    useUIStore.setState({ maskMode: 'quickMask' });
    expect(isMaskEditSelectionMove()).toBe(false);
  });

  it('is false for other tools', () => {
    useUIStore.setState({ activeTool: 'brush' });
    expect(isMaskEditSelectionMove()).toBe(false);
  });
});

describe('maskEditSelectionMoveRefusal', () => {
  const HINT = 'Leave mask edit mode to move or transform a selection.';

  function toasts(): Array<[string, string]> {
    return useNotificationsStore.getState().notifications.map((n) => [n.level, n.message]);
  }

  beforeEach(() => {
    useUIStore.setState({ activeTool: 'move', maskMode: 'layerMask' });
    setSelectionActive(true);
    useNotificationsStore.setState({ notifications: [] });
  });

  it('pins the hint for a mask-edit selection move, without side effects', () => {
    expect(maskEditSelectionMoveRefusal()).toEqual({ reason: HINT, notice: 'info' });
    expect(toasts()).toEqual([]);
  });

  it('null when the move is allowed', () => {
    setSelectionActive(false);
    expect(maskEditSelectionMoveRefusal()).toBeNull();
  });

  it('refuseMaskEditSelectionMove returns true and toasts the hint once', () => {
    expect(refuseMaskEditSelectionMove()).toBe(true);
    expect(toasts()).toEqual([['info', HINT]]);
  });

  it('refuseMaskEditSelectionMove returns false silently when allowed', () => {
    useUIStore.setState({ maskMode: 'off' });
    expect(refuseMaskEditSelectionMove()).toBe(false);
    expect(toasts()).toEqual([]);
  });
});
