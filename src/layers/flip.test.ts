import { describe, it, expect } from 'vitest';
import { mirroredTextureOrigin, planGroupFlip, unionRects, type FlipAxis, type GroupFlipMember } from './flip';
import type { Rect } from './rotate-90';

/**
 * Where document pixel (px, py) of a texture lands after the engine mirrors
 * the texture within itself and the texture is moved to `origin`.
 */
function flipPixel(texture: Rect, origin: { x: number; y: number }, px: number, py: number, axis: FlipAxis): [number, number] {
  const u = px - texture.x;
  const v = py - texture.y;
  return axis === 'horizontal'
    ? [origin.x + (texture.width - 1 - u), origin.y + v]
    : [origin.x + u, origin.y + (texture.height - 1 - v)];
}

describe('unionRects', () => {
  it('returns null for no rects', () => {
    expect(unionRects([])).toBeNull();
  });

  it('covers every rect', () => {
    expect(unionRects([
      { x: 40, y: 60, width: 100, height: 100 },
      { x: 200, y: 100, width: 60, height: 40 },
      { x: -10, y: 300, width: 5, height: 5 },
    ])).toEqual({ x: -10, y: 60, width: 270, height: 245 });
  });
});

describe('mirroredTextureOrigin', () => {
  it('leaves a texture in place when it is the bounds', () => {
    const t: Rect = { x: 30, y: 20, width: 50, height: 40 };
    expect(mirroredTextureOrigin(t, t, 'horizontal')).toEqual({ x: 30, y: 20 });
    expect(mirroredTextureOrigin(t, t, 'vertical')).toEqual({ x: 30, y: 20 });
  });

  it('mirrors every pixel about the centre line of the bounds', () => {
    const bounds: Rect = { x: 40, y: 60, width: 221, height: 101 };
    const texture: Rect = { x: 190, y: 90, width: 70, height: 30 };
    for (const axis of ['horizontal', 'vertical'] as const) {
      const origin = mirroredTextureOrigin(texture, bounds, axis);
      for (const [px, py] of [[190, 90], [259, 119], [200, 100]] as const) {
        const [qx, qy] = flipPixel(texture, origin, px, py, axis);
        if (axis === 'horizontal') {
          expect(qx).toBe(2 * bounds.x + bounds.width - 1 - px);
          expect(qy).toBe(py);
        } else {
          expect(qx).toBe(px);
          expect(qy).toBe(2 * bounds.y + bounds.height - 1 - py);
        }
      }
    }
  });

  it('keeps only the flipped axis moving', () => {
    const bounds: Rect = { x: 0, y: 0, width: 300, height: 200 };
    const texture: Rect = { x: 10, y: 30, width: 40, height: 20 };
    expect(mirroredTextureOrigin(texture, bounds, 'horizontal')).toEqual({ x: 250, y: 30 });
    expect(mirroredTextureOrigin(texture, bounds, 'vertical')).toEqual({ x: 10, y: 150 });
  });
});

describe('planGroupFlip', () => {
  // Two children of one group: a red block (content x 40..140 on a
  // full-canvas texture) and a blue bar cropped to its own 60×40 texture.
  const red: GroupFlipMember = {
    id: 'red',
    texture: { x: 0, y: 0, width: 600, height: 400 },
    content: { x: 40, y: 60, width: 100, height: 100 },
  };
  const blue: GroupFlipMember = {
    id: 'blue',
    texture: { x: 200, y: 100, width: 60, height: 40 },
    content: { x: 0, y: 0, width: 60, height: 40 },
  };

  function contentAfter(member: GroupFlipMember, origin: { x: number; y: number }, axis: FlipAxis): Rect {
    const c = member.content!;
    const local = axis === 'horizontal'
      ? { x: member.texture.width - (c.x + c.width), y: c.y }
      : { x: c.x, y: member.texture.height - (c.y + c.height) };
    return { x: origin.x + local.x, y: origin.y + local.y, width: c.width, height: c.height };
  }

  it('mirrors each child about the group content bounds horizontally', () => {
    const plan = planGroupFlip([red, blue], 'horizontal');
    // Group content spans x 40..260, so a column x maps to 300 - x.
    expect(contentAfter(red, plan.get('red')!, 'horizontal')).toEqual({ x: 160, y: 60, width: 100, height: 100 });
    expect(contentAfter(blue, plan.get('blue')!, 'horizontal')).toEqual({ x: 40, y: 100, width: 60, height: 40 });
  });

  it('mirrors each child about the group content bounds vertically', () => {
    const plan = planGroupFlip([red, blue], 'vertical');
    // Group content spans y 60..160, so a row y maps to 220 - y.
    expect(contentAfter(red, plan.get('red')!, 'vertical')).toEqual({ x: 40, y: 60, width: 100, height: 100 });
    expect(contentAfter(blue, plan.get('blue')!, 'vertical')).toEqual({ x: 200, y: 80, width: 60, height: 40 });
  });

  it('keeps the group extent where it was', () => {
    for (const axis of ['horizontal', 'vertical'] as const) {
      const plan = planGroupFlip([red, blue], axis);
      const after = unionRects([
        contentAfter(red, plan.get('red')!, axis),
        contentAfter(blue, plan.get('blue')!, axis),
      ]);
      expect(after).toEqual({ x: 40, y: 60, width: 220, height: 100 });
    }
  });

  it('flipping twice restores every origin', () => {
    for (const axis of ['horizontal', 'vertical'] as const) {
      const once = planGroupFlip([red, blue], axis);
      const moved = [red, blue].map((m) => ({ ...m, texture: { ...m.texture, ...once.get(m.id)! }, content: m.content && (
        axis === 'horizontal'
          ? { ...m.content, x: m.texture.width - (m.content.x + m.content.width) }
          : { ...m.content, y: m.texture.height - (m.content.y + m.content.height) }
      ) }));
      const twice = planGroupFlip(moved, axis);
      expect(twice.get('red')).toEqual({ x: red.texture.x, y: red.texture.y });
      expect(twice.get('blue')).toEqual({ x: blue.texture.x, y: blue.texture.y });
    }
  });

  it('skips empty members and does not let them widen the bounds', () => {
    const empty: GroupFlipMember = { id: 'empty', texture: { x: 0, y: 0, width: 1, height: 1 }, content: null };
    const zero: GroupFlipMember = { id: 'zero', texture: { x: 500, y: 0, width: 10, height: 10 }, content: { x: 0, y: 0, width: 0, height: 0 } };
    const plan = planGroupFlip([red, empty, zero, blue], 'horizontal');
    expect([...plan.keys()].sort()).toEqual(['blue', 'red']);
    expect(contentAfter(blue, plan.get('blue')!, 'horizontal').x).toBe(40);
  });

  it('returns nothing for a group with no content', () => {
    expect(planGroupFlip([], 'horizontal').size).toBe(0);
    expect(planGroupFlip([{ id: 'e', texture: { x: 0, y: 0, width: 1, height: 1 }, content: null }], 'vertical').size).toBe(0);
  });
});
