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
const { handleLiquifyDown } = await import('./liquify-handlers');
const { handleTiltShiftDown } = await import('./tilt-shift-handlers');
const { handleMeshWarpDown } = await import('./mesh-warp-handlers');
const { useEditorStore } = await import('../editor-store');

function resetSessions(): void {
  useUIStore.setState({ liquify: null, tiltShift: null, meshWarp: null });
}

describe('pre-tool down guards', () => {
  beforeEach(resetSessions);

  describe('handleLiquifyDown', () => {
    it('returns null when no liquify session is active', () => {
      expect(handleLiquifyDown({ x: 10, y: 10 }, 'layer-1')).toBeNull();
    });

    it('returns a liquify-variant state when a session is active', () => {
      const layerId = useEditorStore.getState().document.activeLayerId ?? 'layer-1';
      useUIStore.setState({
        liquify: {
          layerId,
          layerWidth: 256,
          layerHeight: 256,
          settings: { mode: 'push', brushSize: 64, pressure: 0.5 },
        },
      });

      const state = handleLiquifyDown({ x: 25, y: 30 }, layerId);

      expect(state).not.toBeNull();
      expect(state?.drawing).toBe(true);
      expect(state?.gesture.kind).toBe('liquify');
      expect(state?.layerId).toBe(layerId);
    });
  });

  describe('handleTiltShiftDown', () => {
    it('returns null when no tilt-shift session is active', () => {
      expect(handleTiltShiftDown({ x: 10, y: 10 }, 'layer-1')).toBeNull();
    });
  });

  describe('handleMeshWarpDown', () => {
    it('returns null when no mesh-warp session is active', () => {
      expect(handleMeshWarpDown({ x: 10, y: 10 }, 'layer-1')).toBeNull();
    });
  });
});
