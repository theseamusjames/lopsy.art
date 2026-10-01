import { describe, it, expect } from 'vitest';
import { pressGrabsHandle, scalesSelectionOutlineFromHandles, usesTransformHandles } from './handle-tools';

describe('handle-tools', () => {
  it('lets the drag-out selection tools resize the outline from a handle', () => {
    for (const tool of ['marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic'] as const) {
      expect(scalesSelectionOutlineFromHandles(tool)).toBe(true);
      expect(usesTransformHandles(tool)).toBe(true);
    }
  });

  it('gives the Magic Wand every click, even on a handle', () => {
    expect(scalesSelectionOutlineFromHandles('wand')).toBe(false);
    expect(usesTransformHandles('wand')).toBe(false);
  });

  it('keeps pixel transforms on the Move tool only', () => {
    expect(usesTransformHandles('move')).toBe(true);
    expect(scalesSelectionOutlineFromHandles('move')).toBe(false);
    for (const tool of ['brush', 'fill', 'eyedropper', 'text', 'quick-select', 'crop'] as const) {
      expect(usesTransformHandles(tool)).toBe(false);
    }
  });

  describe('pressGrabsHandle', () => {
    const none = { shiftKey: false, altKey: false };
    const shift = { shiftKey: true, altKey: false };
    const alt = { shiftKey: false, altKey: true };
    const both = { shiftKey: true, altKey: true };

    it('lets a plain press on a handle resize for the drag-out selection tools and Move', () => {
      for (const tool of ['marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic', 'move'] as const) {
        expect(pressGrabsHandle(tool, none)).toBe(true);
      }
    });

    it('hands Shift / Alt presses to the selection tool, which starts a shape to combine', () => {
      for (const tool of ['marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic'] as const) {
        expect(pressGrabsHandle(tool, shift)).toBe(false);
        expect(pressGrabsHandle(tool, alt)).toBe(false);
        expect(pressGrabsHandle(tool, both)).toBe(false);
      }
    });

    it('keeps the Move tool on its handles whatever is held', () => {
      expect(pressGrabsHandle('move', shift)).toBe(true);
      expect(pressGrabsHandle('move', alt)).toBe(true);
    });

    it('never gives the handles to the wand or the paint tools', () => {
      expect(pressGrabsHandle('wand', none)).toBe(false);
      expect(pressGrabsHandle('brush', none)).toBe(false);
    });
  });
});
