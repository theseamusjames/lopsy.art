import { getCommand } from '../../../commands/registry';
import { validateParams } from '../../../commands/params';
import type { MenuItem } from './types';

/**
 * A menu item that runs command `id` with `params`. Its disabled and checked
 * state come from the command's enabled() and checked(), read now, as the
 * menu is built on each MenuBar render; an item whose command has neither
 * gets neither, so it renders no aria-disabled and no checkmark column.
 */
export function commandItem(
  label: string,
  id: string,
  params?: Readonly<Record<string, unknown>>,
  shortcut?: string,
): MenuItem {
  const command = getCommand(id);
  if (!command) throw new Error(`Menu item "${label}" runs ${id}, which is not a registered command`);
  const item: MenuItem = { label, command: params === undefined ? { id } : { id, params } };
  if (shortcut !== undefined) item.shortcut = shortcut;
  if (!command.enabled && !command.checked) return item;
  const validated = validateParams(id, command.params, params);
  if (command.enabled) item.disabled = !command.enabled(validated);
  if (command.checked) item.checked = command.checked(validated);
  return item;
}
