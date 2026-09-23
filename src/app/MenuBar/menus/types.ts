export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  checked?: boolean;
  /** Nested items rendered as a hover flyout to the right of this item. */
  submenu?: MenuItem[];
  /**
   * The OS's stock editing command this item stands in for. The desktop
   * (tinyjs) menu swaps in the stock item when a text field has focus, so
   * ⌘C there copies text rather than pixels.
   */
  nativeRole?: NativeEditRole;
}

export type NativeEditRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

export interface MenuDef {
  label: string;
  items: MenuItem[];
}
