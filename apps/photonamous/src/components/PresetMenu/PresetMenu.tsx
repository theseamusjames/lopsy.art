import { useCallback, useId, useRef, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { usePresets } from '../../app/hooks';
import { applyPreset } from '../../app/commands';
import { Button } from '../Button/Button';
import { useMenuKeys } from '@lopsy/ui/a11y/use-menu-keys';
import styles from './PresetMenu.module.css';

interface PresetMenuProps {
  disabled: boolean;
}

/** Applies an edit preset (Lopsy's or the user's own) to the selected photos. */
export function PresetMenu({ disabled }: PresetMenuProps) {
  const [open, setOpen] = useState(false);
  const presets = usePresets();
  const close = useCallback(() => setOpen(false), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, onMenuKeyDown, onTriggerKeyDown } = useMenuKeys({ isOpen: open, onClose: close, onOpen: () => setOpen(true), triggerRef });
  const id = useId();
  const builtIn = presets.filter((p) => p.builtIn);
  const own = presets.filter((p) => !p.builtIn);

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
        <div ref={menuRef} id={`${id}-menu`} className={styles.menu} role="menu" aria-label="Presets" tabIndex={-1} onKeyDown={onMenuKeyDown}>
          <div className={styles.group} role="group" aria-labelledby={`${id}-lopsy`}>
            <span className={styles.heading} id={`${id}-lopsy`} aria-hidden="true">
              Made by Lopsy
            </span>
            {builtIn.map(row)}
          </div>
          <div className={styles.group} role="group" aria-labelledby={`${id}-own`}>
            <span className={styles.heading} id={`${id}-own`} aria-hidden="true">
              Yours
            </span>
            {own.length === 0 ? (
              <button type="button" role="menuitem" aria-disabled="true" tabIndex={-1} className={`${styles.item} ${styles.none}`}>
                Save your own from the Edit view.
              </button>
            ) : (
              own.map(row)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
