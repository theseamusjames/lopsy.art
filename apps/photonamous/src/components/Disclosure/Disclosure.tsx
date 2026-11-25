import { ChevronRight } from 'lucide-react';
import styles from './Disclosure.module.css';

interface DisclosureProps {
  open: boolean;
  onToggle: () => void;
  /** What it opens and closes, said after Open or Close ("Open 2026"). Without it: "Open" or "Close". */
  label?: string;
}

/**
 * A small arrow button that opens and closes a nested list without choosing
 * its row. Place it beside the row's own button, not inside it.
 */
export function Disclosure({ open, onToggle, label }: DisclosureProps) {
  const action = open ? 'Close' : 'Open';
  const name = label ? `${action} ${label}` : action;
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-expanded={open}
      aria-label={name}
      title={name}
      data-open={open}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        // Enter and Space press this button; the library's shortcuts for them must not run too.
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      <ChevronRight size={14} />
    </button>
  );
}
