import { useId, type ReactNode } from 'react';
import type { MenuKeys } from '../a11y/use-menu-keys';
import styles from './Menu.module.css';

export interface MenuProps {
  /** The menu's keyboard, from useMenuKeys: focus moves in when it opens and the keys move between the items. */
  readonly keys: Pick<MenuKeys, 'menuRef' | 'onMenuKeyDown'>;
  /** Its name for screen readers. */
  readonly label: string;
  readonly id?: string;
  /** Where it sits and how wide it is; how it looks is the menu's own. */
  readonly className?: string;
  /** A line under the items that says more about the menu; screen readers hear it as its description. */
  readonly note?: ReactNode;
  readonly children: ReactNode;
}

/** A dropdown or context menu: a panel of items, each with an accent icon, a title and a detail line. */
export function Menu({ keys, label, id, className, note, children }: MenuProps) {
  const noteId = useId();
  return (
    <div ref={keys.menuRef} className={className ? `${styles.menu} ${className}` : styles.menu} onKeyDown={keys.onMenuKeyDown}>
      <div className={styles.items} role="menu" id={id} aria-label={label} aria-describedby={note ? noteId : undefined}>
        {children}
      </div>
      {note && (
        <p className={styles.note} id={noteId}>
          {note}
        </p>
      )}
    </div>
  );
}

export interface MenuItemProps {
  /** Shown before the title, in the accent colour. */
  readonly icon?: ReactNode;
  /** A second line under the title. */
  readonly detail?: ReactNode;
  /** Shown and reachable by the arrow keys, but not chosen. */
  readonly disabled?: boolean;
  readonly onSelect: () => void;
  /** The title. */
  readonly children: ReactNode;
}

export function MenuItem({ icon, detail, disabled = false, onSelect, children }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={styles.item}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onSelect();
      }}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      <span>
        <span className={styles.title}>{children}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </span>
    </button>
  );
}

export function MenuSeparator() {
  return <hr className={styles.separator} />;
}

export interface MenuGroupProps {
  /** Shown above the group's items, and its name for screen readers. */
  readonly label: string;
  readonly children: ReactNode;
}

export function MenuGroup({ label, children }: MenuGroupProps) {
  const labelId = useId();
  return (
    <div className={styles.group} role="group" aria-labelledby={labelId}>
      <span className={styles.groupLabel} id={labelId} aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}
