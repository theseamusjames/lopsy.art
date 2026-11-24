import { useId, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import styles from './EditSection.module.css';

/** A section's eye: the photo shown without the section, the edit unchanged. */
export interface SectionHide {
  readonly isHidden: boolean;
  /** The eye can't be pressed now (the photo is loading, or Before is on). */
  readonly isDisabled: boolean;
  readonly onToggle: () => void;
}

export interface EditSectionProps {
  readonly title: string;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  /** The section's controls are not all at their defaults: said with a dot beside the title, so a folded section shows it is in use. */
  readonly isChanged: boolean;
  /** Buttons at the right of the heading (Auto, Reset): there folded or open. */
  readonly actions?: ReactNode;
  /** Shows the eye after the heading's buttons. */
  readonly hide?: SectionHide | undefined;
  /** A button beside the name (a mask's Rename). With one, the heading's button is as wide as the name, not the row. */
  readonly titleAction?: ReactNode;
  /** In place of the heading's button while the name is being typed. */
  readonly titleEditor?: ReactNode;
  /** Data attributes for the heading's button, so its owner can find it to focus. */
  readonly toggleData?: Readonly<Record<`data-${string}`, string>> | undefined;
  readonly children: ReactNode;
}

/**
 * One section of the Edit panel, folded to its heading until it is opened,
 * as an effect of a group is in Lopsy: an arrow, the name, and its buttons.
 * The controls are rendered only while it is open. One is open at a time
 * (`open-sections.ts`). Its eye shows the photo without the section, as an
 * effect's eye does in Lopsy; the heading says so while it is hidden.
 */
export function EditSection({ title, isOpen, onToggle, isChanged, actions, hide, titleAction, titleEditor, toggleData, children }: EditSectionProps) {
  const bodyId = useId();
  const isHidden = hide?.isHidden ?? false;
  return (
    <section className={styles.section} aria-label={title} data-open={isOpen} data-in-use={isChanged} data-hidden={isHidden}>
      <header className={styles.header} data-beside={titleAction && !titleEditor ? true : undefined}>
        <h2 className={styles.heading}>
          {titleEditor ?? (
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={isOpen}
              aria-controls={isOpen ? bodyId : undefined}
              onClick={onToggle}
              {...toggleData}
            >
              {isOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
              <span>{title}</span>
              {isChanged && <span className={styles.changed} aria-hidden="true" title="In use: not at its defaults" />}
            </button>
          )}
          {/* Said with the heading, outside the button, whose name stays the section's. */}
          {isChanged && <span className={styles.srOnly}>, in use</span>}
          {isHidden && <span className={styles.srOnly}>, hidden</span>}
        </h2>
        {/* Beside the heading, not in it: the heading's name stays the section's. */}
        {!titleEditor && titleAction}
        {(actions || hide) && (
          <div className={styles.actions}>
            {actions}
            {hide && (
              <button
                type="button"
                className={styles.eye}
                aria-label={`Hide ${title}`}
                aria-pressed={isHidden}
                title={isHidden ? `Show ${title} again` : `Hide ${title}: see the photo without it`}
                disabled={hide.isDisabled}
                onClick={hide.onToggle}
              >
                {isHidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              </button>
            )}
          </div>
        )}
      </header>
      {isOpen && (
        <div id={bodyId} className={styles.body}>
          {children}
        </div>
      )}
    </section>
  );
}
