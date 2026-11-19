import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { MAX_COLORS, MIN_COLORS } from '../../components/IndexedColorModal/indexed-color-limits';
import { colorModeLabel } from '../../utils/color-mode';
import type { DocumentColorMode } from '../../types';

/** Image > Mode's items, in the menu's order. */
const MODES = ['rgb', 'grayscale', 'indexed', 'cmyk', 'lab'] as const satisfies readonly DocumentColorMode[];

export interface ColorModeResult {
  colorMode: DocumentColorMode;
}

interface IndexedOptions {
  maxColors: number;
  dither: boolean;
}

function indexedOptions(mode: DocumentColorMode, maxColors?: number, dither?: boolean): IndexedOptions | undefined {
  if (mode === 'indexed') return { maxColors: maxColors ?? MAX_COLORS, dither: dither ?? false };
  if (maxColors !== undefined || dither !== undefined) {
    throw new CommandError('invalid', 'doc.color-mode: maxColors and dither are for mode "indexed" only, as only the Indexed Color dialog asks for them');
  }
  return undefined;
}

export const docColorMode = defineCommand({
  id: 'doc.color-mode',
  summary:
    'Converts the document to another colour mode, as Image > Mode does ("Convert to <Mode>"); indexed takes the Indexed Color dialog\'s palette size and dithering, and flattens the layers into one first. Conversions run one after another, each waiting for the one before, as the menu queues them; one that finds the document already in its mode when its turn comes does nothing and is refused. Checked for the document\'s mode. Resolves once the conversion has finished. Returns the colour mode.',
  surface: 'document',
  params: {
    mode: { type: 'string', enum: MODES },
    maxColors: {
      type: 'number',
      integer: true,
      min: MIN_COLORS,
      max: MAX_COLORS,
      optional: true,
      description: `Indexed only: the palette size ("Colors"), ${MIN_COLORS}-${MAX_COLORS}, default ${MAX_COLORS}.`,
    },
    dither: { type: 'boolean', optional: true, description: 'Indexed only: Floyd-Steinberg dithering ("Dither"), default false.' },
  },
  checked({ mode }): boolean {
    return useEditorStore.getState().document.colorMode === mode;
  },
  run({ mode, maxColors, dither }): Promise<ColorModeResult> {
    requireDocument();
    const options = indexedOptions(mode, maxColors, dither);
    return useEditorStore.getState().convertColorMode(mode, options).then((converted) => {
      const { colorMode } = useEditorStore.getState().document;
      if (colorMode !== mode) throw new CommandError('refused', `The document could not be converted to ${colorModeLabel(mode)}.`);
      if (!converted) throw new CommandError('refused', `The document is already in ${colorModeLabel(mode)} mode.`);
      return { colorMode };
    });
  },
});
