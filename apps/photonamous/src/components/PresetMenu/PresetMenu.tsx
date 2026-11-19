import { useCallback, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { usePresets } from '../../app/hooks';
import { applyPreset } from '../../app/commands';
import { Button } from '../Button/Button';
import { Popover } from '../Popover/Popover';
import styles from './PresetMenu.module.css';

interface PresetMenuProps {
  disabled: boolean;
}

/** Applies an edit preset (Lopsy's or the user's own) to the selected photos. */
export function PresetMenu({ disabled }: PresetMenuProps) {
  const [open, setOpen] = useState(false);
  const presets = usePresets();
  const close = useCallback(() => setOpen(false), []);
  const builtIn = presets.filter((p) => p.builtIn);
  const own = presets.filter((p) => !p.builtIn);

  const row = (p: (typeof presets)[number]) => (
    <button
      key={p.id}
      type="button"
      role="menuitem"
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
        size="sm"
        variant={open ? 'secondary' : 'ghost'}
        title={disabled ? 'Apply a preset: select photos first' : 'Apply a preset to the selected photos'}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Wand2 size={14} />
        Presets
      </Button>
      {open && (
        <Popover onClose={close} label="Presets">
          <div className={styles.menu} role="menu" aria-label="Presets">
            <span className={styles.heading}>Made by Lopsy</span>
            {builtIn.map(row)}
            <span className={styles.heading}>Yours</span>
            {own.length === 0 ? <p className={styles.none}>Save your own from the Edit view.</p> : own.map(row)}
          </div>
        </Popover>
      )}
    </div>
  );
}
