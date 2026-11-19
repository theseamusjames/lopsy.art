import { useId, useState } from 'react';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './CopyEditsDialog.module.css';

export interface CopyGroupOption {
  readonly id: string;
  readonly label: string;
}

interface CopyEditsDialogProps {
  /** What is being copied from, for the title: a file name. */
  sourceName: string;
  groups: readonly CopyGroupOption[];
  /** Ticked when the dialog opens. */
  initial: readonly string[];
  onCopy: (groupIds: string[]) => void;
  onClose: () => void;
}

/** Asks which groups of edits to copy. Used by the library and the Edit view. */
export function CopyEditsDialog({ sourceName, groups, initial, onCopy, onClose }: CopyEditsDialogProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(initial));
  const leadId = useId();
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      title={`Copy edits from ${sourceName}`}
      width="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            data-autofocus
            disabled={chosen.size === 0}
            onClick={() => onCopy(groups.map((g) => g.id).filter((id) => chosen.has(id)))}
          >
            Copy
          </Button>
        </>
      }
    >
      <p className={styles.lead} id={leadId}>
        Choose what to copy. Paste puts it on other photos without changing anything else.
      </p>
      <div className={styles.quick}>
        <button type="button" className={styles.link} onClick={() => setChosen(new Set(groups.map((g) => g.id)))}>
          All
        </button>
        <button type="button" className={styles.link} onClick={() => setChosen(new Set())}>
          None
        </button>
      </div>
      <div className={styles.groups} role="group" aria-label="Edits to copy" aria-describedby={leadId}>
        {groups.map((g) => (
          <label key={g.id} className={styles.option}>
            <input type="checkbox" checked={chosen.has(g.id)} onChange={() => toggle(g.id)} />
            {g.label}
          </label>
        ))}
      </div>
    </Modal>
  );
}
