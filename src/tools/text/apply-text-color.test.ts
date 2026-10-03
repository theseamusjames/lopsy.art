import { describe, it, expect, vi } from 'vitest';

vi.mock('./apply-text-setting', () => ({
  applyCommittedTextLayerPatch: vi.fn(),
  beginTextLayerHistory: vi.fn(),
  endTextLayerHistory: vi.fn(),
}));

import { textColorDisplay } from './apply-text-color';
import type { TextEditingState } from '../../app/ui-store';
import type { TextLayer } from '../../types';

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const RED = { r: 255, g: 0, b: 0, a: 1 };
const BLUE = { r: 0, g: 0, b: 255, a: 1 };

function editing(overrides: Partial<TextEditingState>): TextEditingState {
  return {
    layerId: 't',
    bounds: { x: 0, y: 0, width: null, height: null },
    text: 'HELLO',
    cursorPos: 5,
    selectionAnchor: null,
    isNew: false,
    originalVisible: true,
    ...overrides,
  };
}

describe('textColorDisplay', () => {
  it('shows the foreground colour with nothing to edit', () => {
    expect(textColorDisplay(null, null, BLUE)).toEqual({ color: BLUE, pickerColor: BLUE });
  });

  it('shows the colour of the selected range while editing', () => {
    const e = editing({ cursorPos: 3, selectionAnchor: 1, colorSpans: [{ start: 1, end: 3, color: RED }] });
    expect(textColorDisplay(e, null, BLACK).color).toEqual(RED);
  });

  it('shows mixed for a selection over two colours, opening the picker at its first colour', () => {
    const e = editing({ cursorPos: 4, selectionAnchor: 2, colorSpans: [{ start: 1, end: 3, color: RED }] });
    expect(textColorDisplay(e, null, BLACK)).toEqual({ color: null, pickerColor: RED });
  });

  it('shows the whole text while editing without a selection', () => {
    const e = editing({ colorSpans: [{ start: 1, end: 3, color: RED }] });
    expect(textColorDisplay(e, null, BLACK).color).toBeNull();
    expect(textColorDisplay(editing({}), null, BLUE).color).toEqual(BLUE);
  });

  it('shows the selected committed layer as a whole', () => {
    const layer = { type: 'text', text: 'HELLO', color: RED } as TextLayer;
    expect(textColorDisplay(null, layer, BLACK).color).toEqual(RED);
    const multi = { ...layer, colorSpans: [{ start: 0, end: 1, color: BLUE }] } as TextLayer;
    expect(textColorDisplay(null, multi, BLACK)).toEqual({ color: null, pickerColor: RED });
  });
});
