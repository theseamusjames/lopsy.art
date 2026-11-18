import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Version, VersionId } from '@lopsy/photos-core/library/types';
import styles from './VersionsPanel.module.css';

export interface VersionsPanelProps {
  readonly versions: readonly Version[];
  readonly currentId: VersionId;
  readonly isDisabled: boolean;
  readonly onSelect: (versionId: VersionId) => void;
  /** A new version with the current edit, under `name`. */
  readonly onCreate?: (name: string) => void;
  readonly onRename?: (versionId: VersionId, name: string) => void;
  readonly onDelete?: (versionId: VersionId) => void;
}

type Editing = { readonly kind: 'new' } | { readonly kind: 'rename'; readonly id: VersionId } | null;

/** The photo's versions (spec 5.4): switch, New version, rename and delete. */
export function VersionsPanel({ versions, currentId, isDisabled, onSelect, onCreate, onRename, onDelete }: VersionsPanelProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<VersionId | null>(null);

  const startEditing = (next: Editing, initial: string) => {
    setEditing(next);
    setName(initial);
    setConfirmDelete(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !editing) return;
    if (editing.kind === 'new') onCreate?.(trimmed);
    else onRename?.(editing.id, trimmed);
    setEditing(null);
  };

  const nameForm = (label: string) => (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        className={styles.input}
        aria-label={label}
        value={name}
        autoFocus
        maxLength={80}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(null);
        }}
      />
      <button type="submit" className={styles.small} disabled={!name.trim()}>
        Save
      </button>
    </form>
  );

  return (
    <div className={styles.versions}>
      <ul className={styles.list} aria-label="Versions">
        {versions.map((v) => (
          <li key={v.id} className={styles.row}>
            {editing?.kind === 'rename' && editing.id === v.id ? (
              nameForm('Version name')
            ) : (
              <>
                <button
                  type="button"
                  className={styles.version}
                  aria-current={v.id === currentId ? 'true' : undefined}
                  disabled={isDisabled}
                  onClick={() => onSelect(v.id)}
                >
                  {v.name}
                </button>
                {onRename && (
                  <button type="button" className={styles.icon} aria-label={`Rename ${v.name}`} disabled={isDisabled} onClick={() => startEditing({ kind: 'rename', id: v.id }, v.name)}>
                    <Pencil size={13} aria-hidden />
                  </button>
                )}
                {onDelete && versions.length > 1 && (
                  confirmDelete === v.id ? (
                    <button type="button" className={styles.danger} disabled={isDisabled} onClick={() => onDelete(v.id)}>
                      Delete
                    </button>
                  ) : (
                    <button type="button" className={styles.icon} aria-label={`Delete ${v.name}`} disabled={isDisabled} onClick={() => setConfirmDelete(v.id)}>
                      <Trash2 size={13} aria-hidden />
                    </button>
                  )
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {onCreate &&
        (editing?.kind === 'new' ? (
          nameForm('New version name')
        ) : (
          <button type="button" className={styles.add} disabled={isDisabled} onClick={() => startEditing({ kind: 'new' }, `Version ${versions.length + 1}`)}>
            <Plus size={14} aria-hidden />
            <span>New version</span>
          </button>
        ))}
    </div>
  );
}
