import type { FilterDialogId } from './filter-actions';
import type { ImageDialogId } from './menus/image-menu';
import type { HelpDialogId } from './menus/help-menu';
import type { SelectDialogId } from './menus/select-menu';

/**
 * The dialogs MenuBar owns, by family, with what names one dialog in each.
 * Their open state stays in MenuBar's component state; MenuBar registers an
 * opener per family on mount so a command can open one without importing it.
 */
export interface DialogFamilies {
  filter: FilterDialogId;
  image: ImageDialogId;
  help: HelpDialogId;
  select: SelectDialogId;
  export: 'export';
}

export type DialogFamily = keyof DialogFamilies;

type Opener<F extends DialogFamily> = (id: DialogFamilies[F]) => void;

const openers: { [F in DialogFamily]?: Opener<F> } = {};

export function registerDialogOpener<F extends DialogFamily>(family: F, opener: Opener<F>): void {
  (openers as Record<F, Opener<F> | undefined>)[family] = opener;
}

export function unregisterDialogOpener(family: DialogFamily): void {
  delete openers[family];
}

/** The registered opener for `family`, or null on a page without the menu bar. */
export function dialogOpener<F extends DialogFamily>(family: F): Opener<F> | null {
  return (openers as Record<F, Opener<F> | undefined>)[family] ?? null;
}
