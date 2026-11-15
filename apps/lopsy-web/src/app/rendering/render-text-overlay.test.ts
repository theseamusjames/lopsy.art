import { describe, it, expect, vi } from 'vitest';
import { renderTextEditOverlay } from './render-text-overlay';
import type { TextEditingState } from '../ui-store';
import type { TextStyle } from '../../tools/text/text';

function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D & {
    fillRect: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
  };
}

const style: TextStyle = {
  fontSize: 20,
  fontFamily: 'Inter',
  fontWeight: 400,
  fontStyle: 'normal',
  color: { r: 0, g: 0, b: 0, a: 1 },
  lineHeight: 1.4,
  letterSpacing: 0,
  textAlign: 'left',
};

function editing(overrides: Partial<TextEditingState> = {}): TextEditingState {
  return {
    layerId: 'l',
    bounds: { x: 100, y: 200, width: null, height: null },
    text: 'Hello',
    cursorPos: 5,
    selectionAnchor: null,
    isNew: false,
    originalVisible: true,
    ...overrides,
  };
}

describe('renderTextEditOverlay', () => {
  it('draws the caret at the engine cursor rect (offset by bounds)', () => {
    const ctx = makeCtx();
    // cursorRect [x=30, top=0, height=28] → caret at (130, 200)..(130, 228)
    renderTextEditOverlay(ctx, editing(), style, 1, 0, [30, 0, 28], []);
    expect(ctx.moveTo).toHaveBeenCalledWith(130, 200);
    expect(ctx.lineTo).toHaveBeenCalledWith(130, 228);
  });

  it('hides the caret on the off half of the blink cycle', () => {
    const ctx = makeCtx();
    renderTextEditOverlay(ctx, editing(), style, 1, 45, [30, 0, 28], []);
    expect(ctx.moveTo).not.toHaveBeenCalled();
  });

  it('falls back to the bounds origin when there is no cursor rect', () => {
    const ctx = makeCtx();
    renderTextEditOverlay(ctx, editing({ text: '' }), style, 1, 0, null, []);
    expect(ctx.moveTo).toHaveBeenCalledWith(100, 200);
    // Height = fontSize * lineHeight = 28.
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 228);
  });

  it('fills a highlight rect per selection line, offset by bounds', () => {
    const ctx = makeCtx();
    // Two lines: [x,top,w,h] × 2.
    renderTextEditOverlay(ctx, editing({ selectionAnchor: 0 }), style, 1, 0, [30, 0, 28], [
      10, 0, 40, 28,
      0, 28, 25, 28,
    ]);
    expect(ctx.fillRect).toHaveBeenCalledWith(110, 200, 40, 28);
    expect(ctx.fillRect).toHaveBeenCalledWith(100, 228, 25, 28);
  });

  it('draws an area-text border when bounds has a width', () => {
    const ctx = makeCtx();
    renderTextEditOverlay(ctx, editing({ bounds: { x: 100, y: 200, width: 300, height: 150 } }), style, 1, 0, [0, 0, 28], []);
    expect(ctx.strokeRect).toHaveBeenCalledWith(100, 200, 300, 150);
  });
});
