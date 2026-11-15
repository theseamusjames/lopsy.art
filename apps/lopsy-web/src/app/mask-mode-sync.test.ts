import { describe, it, expect, vi } from 'vitest';
import type { Layer } from '../types';

vi.mock('./editor-store', () => ({ useEditorStore: { subscribe: vi.fn(), getState: vi.fn() } }));
vi.mock('./ui-store', () => ({ useUIStore: { getState: vi.fn() } }));

const { isLayerMaskModeOrphaned } = await import('./mask-mode-sync');

const masked = { id: 'a', mask: { width: 1, height: 1 } } as unknown as Layer;
const plain = { id: 'b', mask: null } as unknown as Layer;

describe('isLayerMaskModeOrphaned (#1150)', () => {
  it('is orphaned when the active layer has no mask', () => {
    expect(isLayerMaskModeOrphaned('layerMask', [masked, plain], 'b')).toBe(true);
    expect(isLayerMaskModeOrphaned('layerMask', [masked], null)).toBe(true);
  });

  it('is not orphaned while the active layer keeps its mask', () => {
    expect(isLayerMaskModeOrphaned('layerMask', [masked, plain], 'a')).toBe(false);
  });

  it('ignores the other mask modes', () => {
    expect(isLayerMaskModeOrphaned('off', [plain], 'b')).toBe(false);
    expect(isLayerMaskModeOrphaned('quickMask', [plain], 'b')).toBe(false);
  });
});
