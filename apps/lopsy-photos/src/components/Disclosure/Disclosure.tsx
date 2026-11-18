import { ChevronRight } from 'lucide-react';
import styles from './Disclosure.module.css';

interface DisclosureProps {
  open: boolean;
  onToggle: () => void;
}

/** A small arrow that opens and closes a nested list without choosing its row. */
export function Disclosure({ open, onToggle }: DisclosureProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={open ? 'Close' : 'Open'}
      className={styles.toggle}
      data-open={open}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
    >
      <ChevronRight size={14} />
    </span>
  );
}
