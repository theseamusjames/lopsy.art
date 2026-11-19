/** The command a menu item runs, and the params it passes. */
export interface MenuCommand {
  readonly id: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface MenuItem {
  label: string;
  shortcut?: string;
  /** What the item runs. An item has exactly one of command or action, or neither (a separator or a submenu parent). */
  command?: MenuCommand;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  checked?: boolean;
  /** Nested items rendered as a hover flyout to the right of this item. */
  submenu?: MenuItem[];
}

export interface MenuDef {
  label: string;
  items: MenuItem[];
}
