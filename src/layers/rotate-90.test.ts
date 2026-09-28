import { describe, it, expect } from 'vitest';
import { rotatedTextureOrigin, type Rect } from './rotate-90';

/** Rotate a local content rect the way the engine rotates the texture. */
function rotateLocal(texture: Rect, content: Rect, direction: 'cw' | 'ccw'): Rect {
  return direction === 'cw'
    ? { x: texture.height - (content.y + content.height), y: content.x, width: content.height, height: content.width }
    : { x: content.y, y: texture.width - (content.x + content.width), width: content.height, height: content.width };
}

function contentInDoc(texture: Rect, content: Rect): Rect {
  return { x: texture.x + content.x, y: texture.y + content.y, width: content.width, height: content.height };
}

function rotate(texture: Rect, content: Rect, direction: 'cw' | 'ccw'): { texture: Rect; content: Rect } {
  const origin = rotatedTextureOrigin(texture, content, direction);
  return {
    texture: { ...origin, width: texture.height, height: texture.width },
    content: rotateLocal(texture, content, direction),
  };
}

describe('rotatedTextureOrigin', () => {
  // 800x600 expanded texture at (0,0) with a 200x100 rect at doc (50,50).
  const texture: Rect = { x: 0, y: 0, width: 800, height: 600 };
  const content: Rect = { x: 50, y: 50, width: 200, height: 100 };

  it('turns the content in place about its own centre (#969)', () => {
    const cw = rotate(texture, content, 'cw');
    // 200x100 centred on (150,100) → 100x200 centred on (150,100).
    expect(contentInDoc(cw.texture, cw.content)).toEqual({ x: 100, y: 0, width: 100, height: 200 });
  });

  it('round-trips CW then CCW exactly', () => {
    const cw = rotate(texture, content, 'cw');
    const back = rotate(cw.texture, cw.content, 'ccw');
    expect(contentInDoc(back.texture, back.content)).toEqual({ x: 50, y: 50, width: 200, height: 100 });
  });

  it('round-trips regardless of where the texture sits (crop/expand between rotations)', () => {
    const cw = rotate(texture, content, 'cw');
    const docRect = contentInDoc(cw.texture, cw.content);
    // Crop the texture to its content, as switching layers does.
    const cropped: Rect = { ...docRect };
    const back = rotate(cropped, { x: 0, y: 0, width: docRect.width, height: docRect.height }, 'ccw');
    expect(contentInDoc(back.texture, back.content)).toEqual({ x: 50, y: 50, width: 200, height: 100 });
  });

  it('round-trips when width and height differ by an odd amount', () => {
    const odd: Rect = { x: 10, y: 20, width: 7, height: 4 };
    const cw = rotate(texture, odd, 'cw');
    const back = rotate(cw.texture, cw.content, 'ccw');
    expect(contentInDoc(back.texture, back.content)).toEqual({ x: 10, y: 20, width: 7, height: 4 });

    const ccw = rotate(texture, odd, 'ccw');
    const forward = rotate(ccw.texture, ccw.content, 'cw');
    expect(contentInDoc(forward.texture, forward.content)).toEqual({ x: 10, y: 20, width: 7, height: 4 });
  });

  it('a square stays exactly in place', () => {
    const square: Rect = { x: 300, y: 200, width: 40, height: 40 };
    for (const dir of ['cw', 'ccw'] as const) {
      const r = rotate(texture, square, dir);
      expect(contentInDoc(r.texture, r.content)).toEqual({ x: 300, y: 200, width: 40, height: 40 });
    }
  });
});
