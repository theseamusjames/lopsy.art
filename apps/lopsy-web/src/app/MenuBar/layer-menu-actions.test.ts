import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
  };
  return {
    calls,
    editor: {
      document: { rootGroupId: 'root' as string | null },
      setActiveLayer: record('setActiveLayer'),
    },
    ui: {
      setShowEffectsDrawer: record('setShowEffectsDrawer'),
      openModal: record('openModal'),
    },
  };
});

vi.mock('../editor-store', () => ({ useEditorStore: { getState: () => mocks.editor } }));
vi.mock('../ui-store', () => ({ useUIStore: { getState: () => mocks.ui } }));

const { openAdjustmentLayer } = await import('./layer-menu-actions');

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.editor.document.rootGroupId = 'root';
});

describe('Layer > Adjustment Layer… (openAdjustmentLayer)', () => {
  it('activates the root group with setActiveLayer, then opens the drawer and the info modal', () => {
    openAdjustmentLayer();
    expect(mocks.calls).toEqual([
      ['setActiveLayer', 'root'],
      ['setShowEffectsDrawer', true],
      ['openModal', { kind: 'adjustmentLayerInfo' }],
    ]);
  });

  it('still opens the drawer and the modal without a root group', () => {
    mocks.editor.document.rootGroupId = null;
    openAdjustmentLayer();
    expect(mocks.calls.map(([name]) => name)).toEqual(['setShowEffectsDrawer', 'openModal']);
  });
});
