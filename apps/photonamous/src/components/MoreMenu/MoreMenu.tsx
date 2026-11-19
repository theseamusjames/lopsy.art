import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
import { useMenuKeys } from '../Menu/use-menu-keys';
import styles from './MoreMenu.module.css';

export interface MoreMenuItem {
  readonly label: string;
  readonly icon: ReactNode;
  /** Shown under the label. */
  readonly hint?: string;
  readonly disabled?: boolean;
  /** A toggle: shown with a tick when on. */
  readonly checked?: boolean;
  readonly run: () => void;
}

interface MoreMenuProps {
  items: readonly MoreMenuItem[];
}

/** The grid toolbar's less used commands, each with its words. */
export function MoreMenu({ items }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { menuRef, onMenuKeyDown, onTriggerKeyDown } = useMenuKeys({ isOpen: open, onClose: close, onOpen: () => setOpen(true), triggerRef });
  return (
    <div className={styles.anchor}>
      <IconButton
        ref={triggerRef}
        label="More"
        icon={<MoreHorizontal size={16} />}
        active={open}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      />
      {open && (
        <div ref={menuRef} id={menuId} className={styles.menu} role="menu" aria-label="More" tabIndex={-1} onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              className={styles.item}
              onClick={() => {
                if (item.disabled) return;
                close();
                item.run();
              }}
            >
              <span className={styles.icon}>{item.icon}</span>
              <span className={styles.text}>
                <span>{item.label}</span>
                {item.hint && <span className={styles.hint}>{item.hint}</span>}
              </span>
              {item.checked && <Check size={14} className={styles.check} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
