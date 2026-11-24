import { useEffect, useRef, useState } from 'react';
import { Pencil, Save, Trash2 } from 'lucide-react';
import type { ExportPreset } from '@lopsy/photos-core/library/types';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { focusedElement } from '@lopsy/ui/a11y/focus-trap';
import styles from './ExportPresetBar.module.css';

interface ExportPresetBarProps {
  presets: readonly ExportPreset[];
  /** The preset the form came from; null once it was changed by hand. */
  selectedId: string | null;
  disabled: boolean;
  onPick: (preset: ExportPreset) => void;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Given to the select, and to the name box while naming, so a <label htmlFor> beside the bar names either. */
  id?: string;
}

/**
 * Export presets, the ones a library starts with and the user's own in
 * one list: pick one, save the current settings as one, rename or delete
 * any of them. When naming ends, or the
 * chosen preset is deleted, focus goes back to the select.
 */
export function ExportPresetBar({ presets, selectedId, disabled, onPick, onSave, onRename, onDelete, id }: ExportPresetBarProps) {
  const [mode, setMode] = useState<'idle' | 'saving' | 'renaming'>('idle');
  const [text, setText] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);
  const wasNaming = useRef(false);
  useEffect(() => {
    if (mode !== 'idle') {
      wasNaming.current = true;
      return;
    }
    if (!wasNaming.current) return;
    wasNaming.current = false;
    // The name box has gone with focus in it.
    if (focusedElement() === null) selectRef.current?.focus();
  }, [mode]);
  const selected = presets.find((p) => p.id === selectedId) ?? null;

  const finish = () => {
    const name = text.trim();
    if (name !== '') {
      if (mode === 'saving') onSave(name);
      else if (mode === 'renaming' && selected) onRename(selected.id, name);
    }
    setMode('idle');
    setText('');
  };

  if (mode !== 'idle') {
    return (
      <div className={styles.bar}>
        <input
          id={id}
          className={styles.input}
          autoFocus
          value={text}
          placeholder={mode === 'saving' ? 'Name these settings' : 'New name'}
          aria-label={mode === 'saving' ? 'Preset name' : 'New preset name'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish();
            if (e.key === 'Escape') {
              e.stopPropagation();
              e.preventDefault();
              setMode('idle');
            }
          }}
        />
        <Button size="sm" variant="primary" disabled={text.trim() === ''} onClick={finish}>
          {mode === 'saving' ? 'Save preset' : 'Rename'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      <select
        ref={selectRef}
        id={id}
        className={styles.select}
        aria-label="Export preset"
        disabled={disabled}
        value={selectedId ?? ''}
        onChange={(e) => {
          const preset = presets.find((p) => p.id === e.target.value);
          if (preset) onPick(preset);
        }}
      >
        <option value="" disabled>
          Your own settings
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <IconButton size="sm" label="Save these settings as a preset" icon={<Save size={13} />} disabled={disabled} onClick={() => setMode('saving')} />
      {selected && (
        <>
          <IconButton
            size="sm"
            label={`Rename ${selected.name}`}
            icon={<Pencil size={12} />}
            onClick={() => {
              setText(selected.name);
              setMode('renaming');
            }}
          />
          <IconButton
            size="sm"
            label={`Delete ${selected.name}`}
            icon={<Trash2 size={12} />}
            onClick={() => {
              selectRef.current?.focus();
              onDelete(selected.id);
            }}
          />
        </>
      )}
    </div>
  );
}
