import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import styles from './PanelContainer.module.css';

interface PanelContainerProps {
  title: string;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function PanelContainer({
  title,
  children,
  collapsed = false,
  onToggle,
}: PanelContainerProps) {
  return (
    <section className={styles.panel} aria-label={title}>
      <button className={styles.header} onClick={onToggle} type="button" aria-expanded={!collapsed} aria-label={`${title} panel`}>
        <span className={styles.chevron} aria-hidden="true">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <span className={styles.title}>{title}</span>
      </button>
      <div className={styles.content}>{children}</div>
    </section>
  );
}
