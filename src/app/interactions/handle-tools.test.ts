import { describe, it, expect } from 'vitest';
import { scalesSelectionOutlineFromHandles, usesTransformHandles } from './handle-tools';

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
});
