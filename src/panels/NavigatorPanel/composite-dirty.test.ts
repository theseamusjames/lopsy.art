// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getCompositeInputVersion } from './composite-dirty';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { DEFAULT_ADJUSTMENTS } from '../../filters/image-adjustments';
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

  it('bumps when a Channels-panel eye icon toggles channel visibility (#723)', () => {
    // Prime the tracker so subscriptions are installed.
    getCompositeInputVersion();
    const before = getCompositeInputVersion();

    useUIStore.getState().toggleChannelVisibility('r');
    expect(getCompositeInputVersion()).toBeGreaterThan(before);

    const afterOne = getCompositeInputVersion();
    useUIStore.getState().toggleChannelVisibility('r');
    expect(getCompositeInputVersion()).toBeGreaterThan(afterOne);
  });

  it('bumps when maskMode changes (layerMask overlay / quickMask) (#723)', () => {
    getCompositeInputVersion();
    // Reset to a known baseline mode.
    useUIStore.setState({ maskMode: 'off' });
    const before = getCompositeInputVersion();

    useUIStore.setState({ maskMode: 'layerMask' });
    expect(getCompositeInputVersion()).toBeGreaterThan(before);

    const afterOne = getCompositeInputVersion();
    useUIStore.setState({ maskMode: 'quickMask' });
    expect(getCompositeInputVersion()).toBeGreaterThan(afterOne);
  });

  it('bumps when image adjustments change (#723)', () => {
    getCompositeInputVersion();
    useUIStore.getState().setAdjustments({ ...DEFAULT_ADJUSTMENTS });
    const before = getCompositeInputVersion();

    useUIStore.getState().setAdjustments({ ...DEFAULT_ADJUSTMENTS, exposure: 0.5 });
    expect(getCompositeInputVersion()).toBeGreaterThan(before);

    const afterOne = getCompositeInputVersion();
    useUIStore.getState().setAdjustmentsEnabled(false);
    expect(getCompositeInputVersion()).toBeGreaterThan(afterOne);
  });
});
