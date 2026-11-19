import { useState, type ReactNode } from 'react';
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

/** The Edit view's left column (spec 5.4): Presets, Versions and History, each collapsible, and the column too. */
export function LeftColumn({ sections }: LeftColumnProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  if (sections.length === 0) return null;

  if (!isOpen) {
    return (
      <aside className={styles.collapsed} aria-label="Presets, versions and history">
        <button type="button" className={styles.iconButton} aria-label="Show the left column" title="Show" onClick={() => setIsOpen(true)}>
          <PanelLeftOpen size={16} aria-hidden />
        </button>
      </aside>
    );
  }

  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className={styles.column} aria-label="Presets, versions and history">
      <div className={styles.columnHeader}>
        <button type="button" className={styles.iconButton} aria-label="Hide the left column" title="Hide" onClick={() => setIsOpen(false)}>
          <PanelLeftClose size={16} aria-hidden />
        </button>
      </div>
      {sections.map((section) => {
        const isSectionOpen = !closed.has(section.id);
        return (
          <section key={section.id} className={styles.section} aria-label={section.title}>
            <button type="button" className={styles.sectionHeader} aria-expanded={isSectionOpen} onClick={() => toggle(section.id)}>
              {isSectionOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <span>{section.title}</span>
            </button>
            {isSectionOpen && <div className={styles.sectionBody}>{section.content}</div>}
          </section>
        );
      })}
    </aside>
  );
}
