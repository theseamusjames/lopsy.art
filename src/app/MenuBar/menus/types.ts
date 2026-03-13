export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export interface MenuDef {
  label: string;
  items: MenuItem[];
}
