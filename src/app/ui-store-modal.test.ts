// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui-store';

function reset(): void {
  useUIStore.setState({ modal: null });
}

describe('ui-store modal slot', () => {
  beforeEach(reset);

  it('starts with no modal open', () => {
    expect(useUIStore.getState().modal).toBeNull();
  });

  it('openModal replaces whatever was there — one at a time', () => {
    const store = useUIStore.getState();
    store.openModal({ kind: 'newDocument' });
    expect(useUIStore.getState().modal).toEqual({ kind: 'newDocument' });

    store.openModal({ kind: 'brush' });
    expect(useUIStore.getState().modal).toEqual({ kind: 'brush' });
  });

  it('closeModal clears the slot', () => {
    const store = useUIStore.getState();
    store.openModal({ kind: 'newDocument' });
    store.closeModal();
    expect(useUIStore.getState().modal).toBeNull();
  });

  it('closeModalOfKind is scoped — only closes if the kind matches', () => {
    const store = useUIStore.getState();
    store.openModal({ kind: 'brush' });

    store.closeModalOfKind('newDocument');
    expect(useUIStore.getState().modal).toEqual({ kind: 'brush' });

    store.closeModalOfKind('brush');
    expect(useUIStore.getState().modal).toBeNull();
  });

  it('shapeSize carries its click payload', () => {
    const click = { center: { x: 10, y: 20 }, layerId: 'L', layerX: 0, layerY: 0 };
    useUIStore.getState().openModal({ kind: 'shapeSize', click });
    const m = useUIStore.getState().modal;
    expect(m?.kind).toBe('shapeSize');
    if (m?.kind === 'shapeSize') expect(m.click).toEqual(click);
  });

  it('strokePath carries its pathId', () => {
    useUIStore.getState().openModal({ kind: 'strokePath', pathId: 'P' });
    const m = useUIStore.getState().modal;
    expect(m?.kind).toBe('strokePath');
    if (m?.kind === 'strokePath') expect(m.pathId).toBe('P');
  });

  describe('backward-compat setters', () => {
    it('setShowNewDocumentModal is scoped to the newDocument kind', () => {
      const store = useUIStore.getState();
      store.openModal({ kind: 'brush' });

      // Closing the new-doc modal shouldn't close an unrelated open modal.
      store.setShowNewDocumentModal(false);
      expect(useUIStore.getState().modal).toEqual({ kind: 'brush' });

      // Opening it replaces whatever was there.
      store.setShowNewDocumentModal(true);
      expect(useUIStore.getState().modal).toEqual({ kind: 'newDocument' });
    });

    it('setPendingShapeClick maps click ↔ slot', () => {
      const store = useUIStore.getState();
      const click = { center: { x: 0, y: 0 }, layerId: 'L', layerX: 0, layerY: 0 };

      store.setPendingShapeClick(click);
      expect(useUIStore.getState().modal).toEqual({ kind: 'shapeSize', click });

      store.setPendingShapeClick(null);
      expect(useUIStore.getState().modal).toBeNull();
    });

    it('setStrokeModalPathId maps id ↔ slot', () => {
      const store = useUIStore.getState();
      store.setStrokeModalPathId('P');
      expect(useUIStore.getState().modal).toEqual({ kind: 'strokePath', pathId: 'P' });

      store.setStrokeModalPathId(null);
      expect(useUIStore.getState().modal).toBeNull();
    });

    it('setShowBrushModal maps boolean ↔ slot', () => {
      const store = useUIStore.getState();
      store.setShowBrushModal(true);
      expect(useUIStore.getState().modal).toEqual({ kind: 'brush' });

      store.setShowBrushModal(false);
      expect(useUIStore.getState().modal).toBeNull();
    });
  });
});
