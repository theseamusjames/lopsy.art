import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import styles from './LeftColumn.module.css';

export interface LeftColumnSection {
  readonly id: string;
  readonly title: string;
  /** Stands for the section in the folded column's strip. */
  readonly icon: ReactNode;
  readonly content: ReactNode;
}

export interface LeftColumnProps {
  readonly sections: readonly LeftColumnSection[];
  /** Folded, the column is a strip of its sections' icons. The button that folds it is the Edit view's, beside Back. */
  readonly isOpen: boolean;
  /** One of the strip's icons was clicked: open the column. */
  readonly onOpen: () => void;
}

/**
 * The Edit view's left column (spec 5.4): Presets, Versions and History,
 * each a heading whose button folds its section. The column folds too,
 * into a strip with an icon for each section; an icon opens the column
 * again with its section unfolded and focus on its heading.
 */
export function LeftColumn({ sections, isOpen, onOpen }: LeftColumnProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  /** The section whose icon opened the column, until its heading has focus. */
  const [shown, setShown] = useState<string | null>(null);
  const baseId = useId();

  useEffect(() => {
    if (!isOpen || shown === null) return;
    const header = document.getElementById(`${baseId}-${shown}-header`);
    header?.scrollIntoView({ block: 'nearest' });
    header?.focus();
    setShown(null);
  }, [isOpen, shown, baseId]);

  if (sections.length === 0) return null;

  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const show = (id: string) => {
    setClosed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setShown(id);
    onOpen();
  };

  if (!isOpen) {
    return (
      <aside className={styles.strip} aria-label="Presets, versions and history">
        {sections.map((section) => (
          <button key={section.id} type="button" className={styles.iconButton} aria-label={`Show ${section.title}`} title={section.title} onClick={() => show(section.id)}>
            {section.icon}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className={styles.column} aria-label="Presets, versions and history">
      <div className={styles.sections}>
        {sections.map((section) => {
          const isSectionOpen = !closed.has(section.id);
          const headerId = `${baseId}-${section.id}-header`;
          const bodyId = `${baseId}-${section.id}-body`;
          return (
            <section key={section.id} className={styles.section} aria-labelledby={headerId}>
              <h2 className={styles.heading}>
                <button
                  type="button"
                  id={headerId}
                  className={styles.sectionHeader}
                  aria-expanded={isSectionOpen}
                  aria-controls={bodyId}
                  onClick={() => toggle(section.id)}
                >
                  {isSectionOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  <span>{section.title}</span>
                </button>
              </h2>
              <div id={bodyId} className={styles.sectionBody} hidden={!isSectionOpen}>
                {section.content}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
