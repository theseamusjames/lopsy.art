import type { MenuDef } from './types';
import type { FilterDialogId } from '../filter-actions';
import { fileMenu } from './file-menu';
import { createEditMenu } from './edit-menu';
import { createImageMenu, type ImageDialogId } from './image-menu';
import { layerMenu } from './layer-menu';
import { createSelectMenu, type SelectDialogId } from './select-menu';
import { createFilterMenu } from './filter-menu';
import { createViewMenu } from './view-menu';
import { createHelpMenu, type HelpDialogId } from './help-menu';

export type { MenuDef, MenuItem } from './types';
export type { ImageDialogId } from './image-menu';
export type { HelpDialogId } from './help-menu';
export type { SelectDialogId } from './select-menu';

export function getMenus(
  showFilterDialog: (id: FilterDialogId) => void,
  showImageDialog: (id: ImageDialogId) => void,
  showHelpDialog: (id: HelpDialogId) => void,
  showSelectDialog: (id: SelectDialogId) => void,
): MenuDef[] {
  return [
    fileMenu,
    createEditMenu(showFilterDialog),
    createImageMenu(showImageDialog),
    layerMenu,
    createSelectMenu(showSelectDialog),
    createFilterMenu(showFilterDialog),
    createViewMenu(),
    createHelpMenu(showHelpDialog),
  ];
}
