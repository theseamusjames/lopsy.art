import { Fragment, useRef } from 'react';
import type { ReactNode } from 'react';
import type { LayoutNode, SplitNode } from '../dock-layout';
import { applySplitDrag, SPLIT_MIN_PANE_PX } from '../dock-layout';
import { useDockStore } from '../dock-store';
import { DockTabs } from '../DockTabs/DockTabs';
import { DockSplitter } from '../DockSplitter/DockSplitter';
import styles from './DockZone.module.css';

interface DockZoneProps {
  node: LayoutNode;
  renderPanel: (panelId: string) => ReactNode;
}

/** Recursively renders a dock subtree: tab groups and resizable splits. */
export function DockZone({ node, renderPanel }: DockZoneProps) {
  if (node.kind === 'tabs') {
    return (
      <DockTabs
        groupId={node.id}
        tabs={node.tabs}
        activeTab={node.activeTab}
        renderPanel={renderPanel}
      />
    );
  }
  return <SplitView node={node} renderPanel={renderPanel} />;
}

function SplitView({ node, renderPanel }: { node: SplitNode; renderPanel: (id: string) => ReactNode }) {
  const resizeSplit = useDockStore((s) => s.resizeSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sizes: number[]; containerPx: number } | null>(null);

  const handleDragStart = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      sizes: [...node.sizes],
      containerPx: node.direction === 'row' ? rect.width : rect.height,
    };
  };

  const handleDrag = (dividerIndex: number, deltaPx: number) => {
    const drag = dragRef.current;
    if (!drag || drag.containerPx <= 0) return;
    resizeSplit(
      node.id,
      applySplitDrag(
        drag.sizes,
        dividerIndex,
        deltaPx / drag.containerPx,
        SPLIT_MIN_PANE_PX / drag.containerPx,
      ),
    );
  };

  return (
    <div ref={containerRef} className={node.direction === 'row' ? styles.row : styles.column}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <DockSplitter
              orientation={node.direction === 'row' ? 'vertical' : 'horizontal'}
              label="Resize panels"
              onDragStart={handleDragStart}
              onDrag={(delta) => handleDrag(i - 1, delta)}
            />
          )}
          <div
            className={styles.pane}
            style={{ '--pane-size': node.sizes[i] ?? 1 } as React.CSSProperties}
          >
            <DockZone node={child} renderPanel={renderPanel} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
