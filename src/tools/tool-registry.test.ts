// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  toolRegistry,
  PAINT_TOOLS,
  GPU_TOOLS,
  SHORTCUT_TO_TOOL,
} from './tool-registry';
import type { ToolId } from '../types';

const ALL_TOOL_IDS: ToolId[] = [
  'move', 'brush', 'pencil', 'eraser', 'fill', 'gradient', 'eyedropper',
  'stamp', 'dodge', 'smudge', 'marquee-rect', 'marquee-ellipse',
  'lasso', 'lasso-magnetic', 'wand', 'shape', 'text', 'crop', 'path',
];

describe('tool registry', () => {
  it('has a descriptor for every ToolId', () => {
    for (const id of ALL_TOOL_IDS) {
      expect(toolRegistry[id]).toBeDefined();
      expect(toolRegistry[id].id).toBe(id);
      expect(typeof toolRegistry[id].label).toBe('string');
    }
  });

  it('exposes the same paint set the manual constant used to', () => {
    expect(new Set(PAINT_TOOLS)).toEqual(new Set<ToolId>([
      'brush', 'pencil', 'eraser', 'dodge', 'stamp',
    ]));
  });

  it('exposes the same GPU set the manual constant used to', () => {
    expect(new Set(GPU_TOOLS)).toEqual(new Set<ToolId>([
      'brush', 'pencil', 'eraser', 'dodge', 'stamp', 'gradient', 'shape',
    ]));
  });

  it('preserves every keyboard shortcut from the prior hand-written map', () => {
    const expected: Record<string, ToolId> = {
      v: 'move',
      b: 'brush',
      n: 'pencil',
      e: 'eraser',
      g: 'fill',
      i: 'eyedropper',
      t: 'text',
      u: 'shape',
      m: 'marquee-rect',
      l: 'lasso',
      w: 'wand',
      c: 'crop',
      p: 'path',
      s: 'stamp',
      o: 'dodge',
      r: 'smudge',
    };
    for (const [key, id] of Object.entries(expected)) {
      expect(SHORTCUT_TO_TOOL.get(key)).toBe(id);
    }
    // Reverse: no extra shortcuts crept in.
    expect(SHORTCUT_TO_TOOL.size).toBe(Object.keys(expected).length);
  });

  it('uses unique single-key shortcuts (no two tools claim the same key)', () => {
    const seen = new Map<string, ToolId>();
    for (const d of Object.values(toolRegistry)) {
      if (!d.shortcut) continue;
      const prev = seen.get(d.shortcut);
      if (prev) {
        throw new Error(`Tools ${prev} and ${d.id} both claim shortcut '${d.shortcut}'`);
      }
      seen.set(d.shortcut, d.id);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('every paint tool also renders on the GPU (paint ⊆ gpu)', () => {
    for (const id of PAINT_TOOLS) {
      expect(GPU_TOOLS.has(id)).toBe(true);
    }
  });
});
