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
    <div className={styles.panel}>
      <button className={styles.header} onClick={onToggle} type="button">
        <span className={styles.chevron}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <span className={styles.title}>{title}</span>
      </button>
      {!collapsed && <div className={styles.content}>{children}</div>}
    </div>
  );
}
