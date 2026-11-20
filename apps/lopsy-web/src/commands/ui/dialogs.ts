import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { dialogOpener, type DialogFamilies, type DialogFamily } from '../../app/MenuBar/dialog-openers';
import type { FilterDialogId } from '../../app/MenuBar/filter-actions';
import type { ImageDialogId } from '../../app/MenuBar/menus/image-menu';
import type { HelpDialogId } from '../../app/MenuBar/menus/help-menu';
import type { SelectDialogId } from '../../app/MenuBar/menus/select-menu';

function ids<T extends string>(table: Record<T, true>): T[] {
  return Object.keys(table) as T[];
}

const FILTER_DIALOGS = ids<FilterDialogId>({
  'gaussian-blur': true, 'box-blur': true, 'unsharp-mask': true, 'add-noise': true,
  'brightness-contrast': true, 'hue-saturation': true, posterize: true, threshold: true,
  'motion-blur': true, 'radial-blur': true, 'find-edges': true, 'cel-shading': true,
  clouds: true, smoke: true, pixelate: true, halftone: true, solarize: true, kaleidoscope: true,
  'oil-paint': true, 'chromatic-aberration': true, 'pixel-stretch': true, 'lens-distortion': true,
  bloom: true, 'surface-blur': true, 'pattern-fill': true, emboss: true, voronoi: true,
  fibers: true, sunburst: true, texture: true, 'color-lut': true,
});

const IMAGE_DIALOGS = ids<ImageDialogId>({ 'canvas-size': true, 'image-size': true, border: true, 'convert-to-indexed': true });
const HELP_DIALOGS = ids<HelpDialogId>({ 'keyboard-shortcuts': true, about: true });
const SELECT_DIALOGS = ids<SelectDialogId>({ grow: true, shrink: true, feather: true });

/** Opens a menu-owned dialog through the opener MenuBar registered for its family. */
export function openMenuDialog<F extends DialogFamily>(family: F, id: DialogFamilies[F]): void {
  const open = dialogOpener(family);
  if (!open) {
    throw new CommandError('unavailable', 'The menu bar is not on this page, so its dialogs cannot be opened.');
  }
  open(id);
}

export const uiDialogFilter = defineCommand({
  id: 'ui.dialog.filter',
  summary:
    'Opens a Filter menu dialog (or Edit > Fill with Pattern... and Filter > Color LUT...), closing the open menu, as choosing its item does. Nothing is applied until its Apply. Returns nothing.',
  surface: 'ui',
  settles: false,
  params: { dialog: { type: 'string', enum: FILTER_DIALOGS, description: 'The filter\'s id: gaussian-blur, pattern-fill, color-lut, ...' } },
  run({ dialog }): void {
    openMenuDialog('filter', dialog);
  },
});

export const uiDialogImage = defineCommand({
  id: 'ui.dialog.image',
  summary:
    'Opens an Image menu dialog (Canvas Size..., Image Size..., Border..., or Mode > Indexed Color...), closing the open menu, as choosing its item does. Returns nothing.',
  surface: 'ui',
  settles: false,
  params: { dialog: { type: 'string', enum: IMAGE_DIALOGS } },
  run({ dialog }): void {
    openMenuDialog('image', dialog);
  },
});

export const uiDialogSelect = defineCommand({
  id: 'ui.dialog.select',
  summary: 'Opens the Select > Grow..., Shrink... or Feather... dialog, closing the open menu, as choosing its item does. Returns nothing.',
  surface: 'ui',
  settles: false,
  params: { dialog: { type: 'string', enum: SELECT_DIALOGS } },
  run({ dialog }): void {
    openMenuDialog('select', dialog);
  },
});

export const uiDialogHelp = defineCommand({
  id: 'ui.dialog.help',
  summary: 'Opens Help > Keyboard Shortcuts or About Lopsy, closing the open menu, as choosing its item does. Returns nothing.',
  surface: 'ui',
  settles: false,
  params: { dialog: { type: 'string', enum: HELP_DIALOGS } },
  run({ dialog }): void {
    openMenuDialog('help', dialog);
  },
});

export const uiDialogExport = defineCommand({
  id: 'ui.dialog.export',
  summary: 'Opens the File > Export… dialog, closing the open menu, as choosing its item does. Returns nothing.',
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    openMenuDialog('export', 'export');
  },
});
