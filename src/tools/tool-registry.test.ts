// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  toolRegistry,
  PAINT_TOOLS,
  GPU_TOOLS,
  SELF_HISTORY_PAINT_TOOLS,
  SHORTCUT_TO_TOOL,
} from './tool-registry';
import type { ToolId } from '../types';

const ALL_TOOL_IDS: ToolId[] = [
  'move', 'brush', 'pencil', 'eraser', 'fill', 'gradient', 'eyedropper',
  'stamp', 'healing', 'dodge', 'sponge', 'smudge', 'marquee-rect', 'marquee-ellipse',
  'lasso', 'lasso-magnetic', 'wand', 'quick-select', 'shape', 'text', 'crop', 'path', 'spray',
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
      'brush', 'pencil', 'eraser', 'dodge', 'sponge', 'stamp', 'healing', 'spray',
    ]));
  });

  it('exposes the same GPU set the manual constant used to', () => {
    expect(new Set(GPU_TOOLS)).toEqual(new Set<ToolId>([
      'brush', 'pencil', 'eraser', 'dodge', 'sponge', 'smudge', 'stamp', 'healing', 'gradient', 'shape', 'spray',
    ]))
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
      h: 'healing',
      o: 'dodge',
      y: 'sponge',
      r: 'smudge',
      j: 'spray',
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

  it('flags exactly the paint tools that push their own history entry (#887)', () => {
    // Dodge/Burn, Sponge, Clone Stamp, and Healing push (or correctly skip)
    // their own labeled history entry from their down-handler. Brush,
    // Pencil, Eraser, and Spray rely on the generic dispatch in
    // useCanvasInteraction.ts, so they must NOT be in this set — otherwise
    // the generic fallback would stop pushing their history entry too.
    expect(new Set(SELF_HISTORY_PAINT_TOOLS)).toEqual(new Set<ToolId>([
      'dodge', 'sponge', 'stamp', 'healing',
    ]));
    for (const id of SELF_HISTORY_PAINT_TOOLS) {
      expect(PAINT_TOOLS.has(id)).toBe(true);
    }
  });

  it('most paint tools also render on the GPU', () => {
    const exceptions = new Set<ToolId>([]);
    for (const id of PAINT_TOOLS) {
      if (exceptions.has(id)) continue;
      expect(GPU_TOOLS.has(id)).toBe(true);
    }
  });
});
