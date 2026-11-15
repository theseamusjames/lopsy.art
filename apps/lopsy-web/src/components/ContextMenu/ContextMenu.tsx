import { useEffect, useLayoutEffect, useRef } from 'react';
import styles from './ContextMenu.module.css';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Position the menu via the DOM ref so no inline style prop is needed.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Adjust if the menu overflows the viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 4}px`;
    }
  }, [x, y]);

  return (
    <>
      <div className={styles.overlay} onMouseDown={onClose} />
      <div
        ref={menuRef}
        className={styles.menu}
        role="menu"
        aria-label="Context menu"
      >
        {items.map((item, i) => {
          if (item.separator) {
            return <hr key={i} className={styles.separator} />;
          }
          return (
            <button
              key={i}
              className={styles.item}
              disabled={item.disabled}
              role="menuitem"
              onClick={() => {
                item.action();
                onClose();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
