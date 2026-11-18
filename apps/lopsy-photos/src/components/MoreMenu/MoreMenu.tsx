import { useCallback, useState, type ReactNode } from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
import { Popover } from '../Popover/Popover';
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
  return (
    <div className={styles.anchor}>
      <IconButton label="More" icon={<MoreHorizontal size={16} />} active={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <Popover onClose={close} label="More">
          <div className={styles.menu} role="menu" aria-label="More">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked}
                className={styles.item}
                disabled={item.disabled}
                onClick={() => {
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
        </Popover>
      )}
    </div>
  );
}
