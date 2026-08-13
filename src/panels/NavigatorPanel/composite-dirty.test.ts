// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getCompositeInputVersion } from './composite-dirty';
import { useEditorStore } from '../../app/editor-store';
import { pixelDataManager } from '../../engine/pixel-data-manager';

describe('composite-dirty (getCompositeInputVersion)', () => {
  it('bumps when the editor document reference changes', () => {
    const before = getCompositeInputVersion();
    useEditorStore.setState((s) => ({
      document: { ...s.document, name: 'renamed-' + Math.random() },
    }));
    expect(getCompositeInputVersion()).toBeGreaterThan(before);
  });

  it('bumps when pixelDataManager fires a mutation', () => {
    const before = getCompositeInputVersion();
    pixelDataManager.bumpVersion('any-layer-id');
    expect(getCompositeInputVersion()).toBeGreaterThan(before);
  });

  it('does NOT bump on viewport pan or zoom — the composite content is unchanged (#711)', () => {
    // Prime the tracker by touching the doc once, so any latent
    // subscription is installed before the baseline read.
    useEditorStore.setState((s) => ({ document: { ...s.document } }));
    const before = getCompositeInputVersion();

    useEditorStore.getState().setPan(100, 50);
    useEditorStore.getState().setZoom(2);
    useEditorStore.getState().setPan(-30, 200);

    expect(getCompositeInputVersion()).toBe(before);
  });
});
