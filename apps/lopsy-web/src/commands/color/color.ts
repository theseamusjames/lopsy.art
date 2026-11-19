import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { colorHex } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { hexToRgb } from '../../utils/color';
import { convertColorToDocMode } from '../../utils/color-mode';
import type { Color } from '../../types';

export interface ColorsResult {
  foreground: string;
  background: string;
}

function colors(): ColorsResult {
  const { foregroundColor, backgroundColor } = useToolSettingsStore.getState();
  return { foreground: colorHex(foregroundColor), background: colorHex(backgroundColor) };
}

/** What the Color panel's hex field commits: the typed RGB with the colour's own alpha, held to the document's mode. */
function panelColor(hex: string, current: Color): Color {
  const parsed = hexToRgb(hex);
  if (!parsed) throw new CommandError('invalid', `color.set: ${hex} is not a colour`);
  const doc = useEditorStore.getState().document;
  return convertColorToDocMode({ ...parsed, a: current.a }, doc.colorMode, doc.indexedPalette);
}

function rejectAlpha(name: string, hex: string | undefined): void {
  if (hex !== undefined && hex.length > 7) {
    throw new CommandError('invalid', `color.set: ${name} must be "#rrggbb": the Color panel's hex field cannot set alpha`);
  }
}

const hexSpec = (which: string) =>
  ({
    type: 'color',
    optional: true,
    description: `The ${which} colour as "#rrggbb" (or "#rgb"), as typed into the Color panel's hex field: its alpha is kept, and in a Grayscale or Indexed document it is held to the mode as the panel holds it.`,
  }) as const;

export const colorSet = defineCommand({
  id: 'color.set',
  summary:
    'Sets the foreground and/or background colour, as typing a hex value into the Color panel\'s field does. Painting and filling commands use these colours. No history step. Returns both colours as hex.',
  surface: 'document',
  settles: false,
  params: { foreground: hexSpec('foreground'), background: hexSpec('background') },
  run({ foreground, background }): ColorsResult {
    if (foreground === undefined && background === undefined) {
      throw new CommandError('invalid', 'color.set: pass foreground, background or both');
    }
    rejectAlpha('foreground', foreground);
    rejectAlpha('background', background);
    const store = useToolSettingsStore.getState();
    if (foreground !== undefined) store.setForegroundColor(panelColor(foreground, store.foregroundColor));
    if (background !== undefined) store.setBackgroundColor(panelColor(background, store.backgroundColor));
    return colors();
  },
});

export const colorSwap = defineCommand({
  id: 'color.swap',
  summary: 'Swaps the foreground and background colours, as the X key and the Color panel\'s Swap button do. No history step. Returns both colours as hex.',
  surface: 'document',
  settles: false,
  params: {},
  run(): ColorsResult {
    useToolSettingsStore.getState().swapColors();
    return colors();
  },
});

export const colorReset = defineCommand({
  id: 'color.reset',
  summary: 'Resets the colours to a black foreground and a white background, as the D key does. No history step. Returns both colours as hex.',
  surface: 'document',
  settles: false,
  params: {},
  run(): ColorsResult {
    useToolSettingsStore.getState().resetColors();
    return colors();
  },
});
