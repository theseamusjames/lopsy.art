import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import styles from './LeftColumn.module.css';

export interface LeftColumnSection {
  readonly id: string;
  readonly title: string;
  readonly content: ReactNode;
}

export interface LeftColumnProps {
  readonly sections: readonly LeftColumnSection[];
}

/**
 * The Edit view's left column (spec 5.4): Presets, Versions and History,
 * each a heading whose button folds its section, and the column folds
 * too, with a button at its bottom left. That button is the same element
 * either way, so it keeps focus.
 */
export function LeftColumn({ sections }: LeftColumnProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const baseId = useId();
  if (sections.length === 0) return null;

  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className={isOpen ? styles.column : styles.collapsed} aria-label="Presets, versions and history">
      {isOpen && (
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
      )}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={isOpen ? 'Hide the left column' : 'Show the left column'}
          title={isOpen ? 'Hide' : 'Show'}
          onClick={() => setIsOpen((v) => !v)}
        >
          {isOpen ? <PanelLeftClose size={16} aria-hidden /> : <PanelLeftOpen size={16} aria-hidden />}
        </button>
      </div>
    </aside>
  );
}
