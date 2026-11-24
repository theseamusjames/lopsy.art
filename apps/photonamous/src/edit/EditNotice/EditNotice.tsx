import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/Button/Button';
import { useDocumentTitle, useFocusOnOpen } from '../edit-page';
import styles from './EditNotice.module.css';

export interface EditNoticeAction {
  readonly label: string;
  readonly icon?: ReactNode;
  /** Runs in the click, so it may open a tab. */
  readonly onClick: () => void;
}

export interface EditNoticeProps {
  /** What was asked to open, or what became of it. */
  readonly heading: string;
  /** The page's title while the notice shows. */
  readonly documentTitle: string;
  /** Why the Edit view does not show it, and what to do instead. */
  readonly children?: ReactNode;
  /** The way on, before Back. */
  readonly action?: EditNoticeAction;
  /** Back: the button, and Escape. */
  readonly onClose: () => void;
  /** The Back button's words; 'Back' by default. */
  readonly closeLabel?: string;
}

/**
 * What the Edit view's place shows for something it cannot open: a
 * heading, which takes focus so a screen reader starts there, a sentence,
 * and the way on. Escape goes back, as it does from the Edit view.
 */
export function EditNotice({ heading, documentTitle, children, action, onClose, closeLabel = 'Back' }: EditNoticeProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useDocumentTitle(documentTitle);
  useFocusOnOpen(headingRef);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <section className={styles.notice} aria-labelledby={headingId} data-testid="edit-notice">
      <h1 ref={headingRef} id={headingId} className={styles.heading} tabIndex={-1}>
        {heading}
      </h1>
      {children !== undefined && <p className={styles.message}>{children}</p>}
      <div className={styles.actions}>
        {action && (
          <Button variant="primary" onClick={action.onClick}>
            {action.icon}
            {action.label}
          </Button>
        )}
        <Button onClick={onClose}>
          <ArrowLeft size={14} />
          {closeLabel}
        </Button>
      </div>
    </section>
  );
}
