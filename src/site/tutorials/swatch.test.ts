import { describe, expect, it } from 'vitest';
import { isHexColor, parsePaletteItem, renderSwatch } from './swatch';

describe('isHexColor', () => {
  it('accepts 3, 4, 6 and 8 digit hex colours', () => {
    expect(['#fff', '#FFFA', '#F2E4C6', '#F2E4C680'].every(isHexColor)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(['#ff', '#GGGGGG', 'F2E4C6', '#F2E4C', '#1'].some(isHexColor)).toBe(false);
  });
});

describe('renderSwatch', () => {
  it('renders a button that copies the code and shows the colour', () => {
    expect(renderSwatch('#F2E4C6')).toBe(
      '<button type="button" data-copy="#F2E4C6" title="Copy #F2E4C6" style="--swatch: #F2E4C6" class="swatch"><code>#F2E4C6</code></button>',
    );
  });
});

describe('parsePaletteItem', () => {
  it('splits several named colours into groups', () => {
    expect(parsePaletteItem('Paper `#F2E4C6`, cream ink `#F7ECD3` and navy `#1F2D52`')).toEqual([
      { label: 'Paper', colors: ['#F2E4C6'], isRamp: false, note: '' },
      { label: 'cream ink', colors: ['#F7ECD3'], isRamp: false, note: '' },
      { label: 'navy', colors: ['#1F2D52'], isRamp: false, note: '' },
    ]);
  });

  it('keeps unnamed follow-on colours with the name before them', () => {
    expect(parsePaletteItem('Mustard `#E9A825` and `#F3C65A`, seed gold `#F4D06A`')).toEqual([
      { label: 'Mustard', colors: ['#E9A825', '#F3C65A'], isRamp: false, note: '' },
      { label: 'seed gold', colors: ['#F4D06A'], isRamp: false, note: '' },
    ]);
  });

  it('recognises arrow ramps, colons and notes', () => {
    expect(parsePaletteItem('Sky: `#0E2446` → `#6B2F6A` → `#FFC75E`')).toEqual([
      { label: 'Sky', colors: ['#0E2446', '#6B2F6A', '#FFC75E'], isRamp: true, note: '' },
    ]);
    expect(parsePaletteItem('Shirt ink `#100C24` (the background, not an ink)')).toEqual([
      { label: 'Shirt ink', colors: ['#100C24'], isRamp: false, note: 'the background, not an ink' },
    ]);
  });

  it('rejects prose that only mentions colours', () => {
    expect(parsePaletteItem('Teal `#2F6E69` with halftone dots in `#6FB3A8`')).toBeNull();
    expect(parsePaletteItem('Constructivist red `#C8261B`, with `#8E1A12` for wings')).toBeNull();
    expect(parsePaletteItem('Neon: cyan `#05D9E8`')).toBeNull();
    expect(parsePaletteItem('Fill the shape with ink `#15110E` and deselect before you go on to the next step')).toBeNull();
    expect(parsePaletteItem('No colours here')).toBeNull();
  });
});
