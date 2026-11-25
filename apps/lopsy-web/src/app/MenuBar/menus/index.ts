// Every menu item runs a command, so the menus need the registry filled.
import '../../../commands';
import type { MenuDef } from './types';
import { createFileMenu } from './file-menu';
import { createEditMenu } from './edit-menu';
import { createImageMenu } from './image-menu';
import { createLayerMenu } from './layer-menu';
import { createSelectMenu } from './select-menu';
import { createFilterMenu } from './filter-menu';
import { createPathMenu } from './path-menu';
import { createViewMenu } from './view-menu';
import { createHelpMenu } from './help-menu';

export type { MenuDef, MenuItem } from './types';
export type { ImageDialogId } from './image-menu';
export type { HelpDialogId } from './help-menu';
export type { SelectDialogId } from './select-menu';

/** The menu bar's menus, with each item's disabled and checked state read now. */
export function getMenus(): MenuDef[] {
  return [
    createFileMenu(),
    createEditMenu(),
    createImageMenu(),
    createLayerMenu(),
    createSelectMenu(),
    createFilterMenu(),
    createPathMenu(),
    createViewMenu(),
    createHelpMenu(),
  ];
}
