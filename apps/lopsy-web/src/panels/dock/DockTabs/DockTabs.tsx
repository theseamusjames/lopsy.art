import { useLayoutEffect, useRef } from 'react';
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

const tabDomId = (groupId: string, panelId: string): string => `dock-tab-${groupId}-${panelId}`;
const panelDomId = (groupId: string): string => `dock-panel-${groupId}`;

export function DockTabs({ groupId, tabs, activeTab, renderPanel, variant = 'docked' }: DockTabsProps) {
  const activateTab = useDockStore((s) => s.activateTab);
  const rootRef = useRef<HTMLDivElement>(null);

  // useLayoutEffect so the group element is registered before ancestor
  // measurements run (useDockedPanelAnchor in App reads it on first mount).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    registerGroupElement(groupId, el);
    return () => unregisterGroupElement(groupId);
  }, [groupId]);

  const handleTabPointerDown = (e: React.PointerEvent<HTMLButtonElement>, panelId: string) => {
    e.stopPropagation();
    // A floating window's only tab drags the whole window — extracting it
    // into a new window would just orphan an identical one.
    if (variant === 'floating' && tabs.length === 1) {
      beginWindowDrag(e, groupId);
      return;
    }
    beginTabDrag(e, panelId, groupId);
    // Activation happens on click (fires for both mouse and keyboard), not
    // here — so a click activates exactly once and a drag doesn't activate a
    // tab it's about to move elsewhere.
  };

  const handleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (variant !== 'floating') return;
    beginWindowDrag(e, groupId);
  };

  // WAI-ARIA tabs keyboard pattern: arrows move (and follow focus to) the
  // active tab; Home/End jump to the ends.
  const handleTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(activeTab);
    if (index === -1) return;
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    const nextPanel = tabs[next];
    if (nextPanel === undefined || nextPanel === activeTab) return;
    e.preventDefault();
    activateTab(groupId, nextPanel);
    document.getElementById(tabDomId(groupId, nextPanel))?.focus();
  };

  const title = getPanelTitle(activeTab);

  return (
    <div ref={rootRef} className={styles.group} data-dock-group={groupId}>
      <div
        className={styles.tabBar}
        role="tablist"
        onPointerDown={handleBarPointerDown}
        onKeyDown={handleTablistKeyDown}
        data-testid={`dock-tabbar-${activeTab}`}
      >
        {tabs.map((panelId) => (
          <button
            key={panelId}
            id={tabDomId(groupId, panelId)}
            type="button"
            role="tab"
            aria-selected={panelId === activeTab}
            aria-controls={panelDomId(groupId)}
            tabIndex={panelId === activeTab ? 0 : -1}
            className={panelId === activeTab ? styles.tabActive : styles.tab}
            data-dock-tab={panelId}
            onPointerDown={(e) => handleTabPointerDown(e, panelId)}
            onClick={() => activateTab(groupId, panelId)}
          >
            {getPanelTitle(panelId)}
          </button>
        ))}
      </div>
      <section id={panelDomId(groupId)} className={styles.content} role="tabpanel" aria-label={title}>
        {renderPanel(activeTab)}
      </section>
    </div>
  );
}
