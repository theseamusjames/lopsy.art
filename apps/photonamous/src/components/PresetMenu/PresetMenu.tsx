import { useCallback, useId, useRef, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { usePresets } from '../../app/hooks';
import { applyPreset } from '../../app/commands';
import { Button } from '../Button/Button';
import { useMenuKeys } from '@lopsy/ui/a11y/use-menu-keys';
import { useMenuSide } from '../menu-side';
import styles from './PresetMenu.module.css';

/** The menu's width as PresetMenu.module.css sets it, for choosing its side. */
const MENU_WIDTH = 220;

interface PresetMenuProps {
  disabled: boolean;
}

/** Applies one of the library's edit presets to the selected photos. They are made, renamed and deleted in the Edit view. */
export function PresetMenu({ disabled }: PresetMenuProps) {
  const [open, setOpen] = useState(false);
  const presets = usePresets();
  const close = useCallback(() => setOpen(false), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, onMenuKeyDown, onTriggerKeyDown } = useMenuKeys({ isOpen: open, onClose: close, onOpen: () => setOpen(true), triggerRef });
  const id = useId();
  const side = useMenuSide(triggerRef, open, MENU_WIDTH);

  const row = (p: (typeof presets)[number]) => (
    <button
      key={p.id}
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={styles.item}
      onClick={() => {
        close();
        applyPreset(p.id);
      }}
    >
      {p.name}
    </button>
  );

  return (
    <div className={styles.anchor}>
      <Button
        ref={triggerRef}
        size="sm"
        variant={open ? 'secondary' : 'ghost'}
        title={disabled ? 'Apply a preset: select photos first' : 'Apply a preset to the selected photos'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <Wand2 size={14} />
        Presets
      </Button>
      {open && (
        <div ref={menuRef} id={`${id}-menu`} className={styles.menu} data-side={side} role="menu" aria-label="Presets" tabIndex={-1} onKeyDown={onMenuKeyDown}>
          {presets.length === 0 ? (
            <button type="button" role="menuitem" aria-disabled="true" tabIndex={-1} className={`${styles.item} ${styles.none}`}>
              No presets. Save one from the Edit view.
            </button>
          ) : (
            presets.map(row)
          )}
        </div>
      )}
    </div>
  );
}
