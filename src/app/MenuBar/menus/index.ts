import type { MenuDef } from './types';
import type { FilterDialogId } from '../filter-actions';
import { fileMenu } from './file-menu';
import { editMenu } from './edit-menu';
import { imageMenu } from './image-menu';
import { layerMenu } from './layer-menu';
import { selectMenu } from './select-menu';
import { createFilterMenu } from './filter-menu';
import { viewMenu } from './view-menu';
import { helpMenu } from './help-menu';

export type { MenuDef, MenuItem } from './types';

export const menuRegistry: Record<string, MenuDef> = {
  file: fileMenu,
  edit: editMenu,
  image: imageMenu,
  layer: layerMenu,
  select: selectMenu,
  view: viewMenu,
  help: helpMenu,
};

export function getMenus(showFilterDialog: (id: FilterDialogId) => void): MenuDef[] {
  return [
    fileMenu,
    editMenu,
    imageMenu,
    layerMenu,
    selectMenu,
    createFilterMenu(showFilterDialog),
    viewMenu,
    helpMenu,
  ];
}
