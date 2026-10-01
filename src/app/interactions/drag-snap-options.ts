import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { GUIDE_SNAP_SCREEN_PX, type DragSnapOptions } from '../../tools/common/drag-snap';

/**
 * The snap targets a drag-out box sees right now: the grid when Show Grid
 * and Snap to Grid are on, and the visible guides when Snap to Guides is on.
 */
export function dragSnapOptions(): DragSnapOptions {
  const ui = useUIStore.getState();
  const { document: doc, viewport } = useEditorStore.getState();
  const guides = ui.showGuides && ui.snapToGuides ? ui.guides : [];
  return {
    grid: ui.showGrid && ui.snapToGrid
      ? { size: ui.gridSize, docWidth: doc.width, docHeight: doc.height }
      : null,
    verticalGuides: guides.filter((g) => g.orientation === 'vertical').map((g) => g.position),
    horizontalGuides: guides.filter((g) => g.orientation === 'horizontal').map((g) => g.position),
    guideThreshold: GUIDE_SNAP_SCREEN_PX / viewport.zoom,
  };
}
