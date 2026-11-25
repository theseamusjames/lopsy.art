import { useId, useState } from 'react';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './NewVersionDialog.module.css';

interface NewVersionDialogProps {
  /** Offered, and selected so typing replaces it. */
  suggested: string;
  onCreate: (name: string) => void;
  onClose: () => void;
}

/** Names a new version before it is made: another edit of the photo, the original untouched. */
export function NewVersionDialog({ suggested, onCreate, onClose }: NewVersionDialogProps) {
  const [name, setName] = useState(suggested);
  const id = useId();
  const create = () => onCreate(name.trim() || suggested);
  return (
    <Modal
      title="New version"
      width="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <p className={styles.lead} id={`${id}-lead`}>
        A new version starts from this one’s edits. The original is never changed.
      </p>
      <label className={styles.label} htmlFor={`${id}-name`}>
        Version name
      </label>
      <input
        id={`${id}-name`}
        className={styles.input}
        aria-describedby={`${id}-lead`}
        value={name}
        data-autofocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
        }}
      />
    </Modal>
  );
}
