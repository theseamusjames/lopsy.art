import type { MenuDef } from './types';
import type { FilterDialogId } from '../filter-actions';
import { fileMenu } from './file-menu';
import { editMenu } from './edit-menu';
import { createImageMenu, type ImageDialogId } from './image-menu';
import { layerMenu } from './layer-menu';
import { selectMenu } from './select-menu';
import { createFilterMenu } from './filter-menu';
import { viewMenu } from './view-menu';
import { helpMenu } from './help-menu';

export type { MenuDef, MenuItem } from './types';
export type { ImageDialogId } from './image-menu';

export function getMenus(
  showFilterDialog: (id: FilterDialogId) => void,
  showImageDialog: (id: ImageDialogId) => void,
): MenuDef[] {
  return [
    fileMenu,
    editMenu,
    createImageMenu(showImageDialog),
    layerMenu,
    selectMenu,
    createFilterMenu(showFilterDialog),
    viewMenu,
    helpMenu,
  ];
}
