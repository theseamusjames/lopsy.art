import type { MenuDef } from './types';
import type { FilterDialogId } from '../filter-actions';
import { fileMenu } from './file-menu';
import { createEditMenu } from './edit-menu';
import { createImageMenu, type ImageDialogId } from './image-menu';
import { layerMenu } from './layer-menu';
import { selectMenu } from './select-menu';
import { createFilterMenu } from './filter-menu';
import { createViewMenu } from './view-menu';
import { createHelpMenu, type HelpDialogId } from './help-menu';

export type { MenuDef, MenuItem } from './types';
export type { ImageDialogId } from './image-menu';
export type { HelpDialogId } from './help-menu';

export function getMenus(
  showFilterDialog: (id: FilterDialogId) => void,
  showImageDialog: (id: ImageDialogId) => void,
  showHelpDialog: (id: HelpDialogId) => void,
): MenuDef[] {
  return [
    fileMenu,
    createEditMenu(showFilterDialog),
    createImageMenu(showImageDialog),
    layerMenu,
    selectMenu,
    createFilterMenu(showFilterDialog),
    createViewMenu(),
    createHelpMenu(showHelpDialog),
  ];
}
