import { useLayoutEffect, useState } from 'react';
import { useDockStore } from '../../panels/dock/dock-store';
import { findPanelGroupId } from '../../panels/dock/dock-layout';
import {
  getGroupElement,
  getHostElement,
  subscribeElementChanges,
} from '../../panels/dock/dock-element-registry';
import type { DockablePanelId } from '../../panels/dock/panel-registry';

/**
 * Track a docked panel's top-edge offset relative to the dock host, so
 * floating drawers can anchor beside the panel rather than the viewport
 * corner. Returns null when the panel is missing, floating, or not yet
 * mounted — callers should fall back to their default anchor in that case.
 *
 * Re-measures on dock-layout changes (splitter drags, dock resizes,
 * tab moves) and on window resizes. Docked panel positions are driven by
 * flex layout inside the host, so the layout store is the source of truth
 * for "something moved"; no ResizeObserver on sibling groups is needed.
 */
export function useDockedPanelAnchor(panelId: DockablePanelId): number | null {
  const layout = useDockStore((s) => s.layout);
  const groupId = findPanelGroupId(layout, panelId);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!groupId) {
      setTop(null);
      return;
    }
    const measure = (): void => {
      const host = getHostElement();
      const el = getGroupElement(groupId);
      if (!host || !el) {
        setTop(null);
        return;
      }
      // Floating windows use absolute positioning inside the host; a docked
      // drawer that tried to anchor to one would jitter as the window moves.
      const isFloating = layout.floating.some((w) => w.id === groupId);
      if (isFloating) {
        setTop(null);
        return;
      }
      const hostRect = host.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setTop(elRect.top - hostRect.top);
    };
    measure();
    const unsubscribe = subscribeElementChanges(measure);
    window.addEventListener('resize', measure);
    return () => {
      unsubscribe();
      window.removeEventListener('resize', measure);
    };
  }, [groupId, layout]);

  return top;
}
