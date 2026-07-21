import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useDockStore } from '../dock-store';
import { getPanelTitle } from '../panel-registry';
import { beginTabDrag, beginWindowDrag } from '../dock-drag-controller';
import { registerGroupElement, unregisterGroupElement } from '../dock-element-registry';
import styles from './DockTabs.module.css';

interface DockTabsProps {
  groupId: string;
  tabs: string[];
  activeTab: string;
  renderPanel: (panelId: string) => ReactNode;
  /** Floating groups drag their window by the tab bar's empty area. */
  variant?: 'docked' | 'floating';
}

export function DockTabs({ groupId, tabs, activeTab, renderPanel, variant = 'docked' }: DockTabsProps) {
  const activateTab = useDockStore((s) => s.activateTab);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    registerGroupElement(groupId, el);
    return () => unregisterGroupElement(groupId);
  }, [groupId]);

  const handleTabPointerDown = (e: React.PointerEvent<HTMLButtonElement>, panelId: string) => {
    e.stopPropagation();
    activateTab(groupId, panelId);
    // A floating window's only tab drags the whole window — extracting it
    // into a new window would just orphan an identical one.
    if (variant === 'floating' && tabs.length === 1) {
      beginWindowDrag(e, groupId);
      return;
    }
    beginTabDrag(e, panelId, groupId);
  };

  const handleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (variant !== 'floating') return;
    beginWindowDrag(e, groupId);
  };

  const title = getPanelTitle(activeTab);

  return (
    <div ref={rootRef} className={styles.group} data-dock-group={groupId}>
      <div
        className={styles.tabBar}
        role="tablist"
        onPointerDown={handleBarPointerDown}
        data-testid={`dock-tabbar-${activeTab}`}
      >
        {tabs.map((panelId) => (
          <button
            key={panelId}
            type="button"
            role="tab"
            aria-selected={panelId === activeTab}
            className={panelId === activeTab ? styles.tabActive : styles.tab}
            data-dock-tab={panelId}
            onPointerDown={(e) => handleTabPointerDown(e, panelId)}
            onClick={() => activateTab(groupId, panelId)}
          >
            {getPanelTitle(panelId)}
          </button>
        ))}
      </div>
      <section className={styles.content} role="tabpanel" aria-label={title}>
        {renderPanel(activeTab)}
      </section>
    </div>
  );
}
