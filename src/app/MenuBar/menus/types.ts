export interface MenuItem {
  label: string;
  shortcut?: string;
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
