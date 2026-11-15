// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui-store';

function reset(): void {
  useUIStore.setState({ showGrid: false, snapToGrid: false, hasUserToggledSnapToGrid: false });
}

describe('ui-store Show Grid / Snap to Grid', () => {
  beforeEach(reset);

  it('turns Snap on the first time the grid is shown', () => {
    useUIStore.getState().toggleGrid();
    expect(useUIStore.getState()).toMatchObject({ showGrid: true, snapToGrid: true });
  });

  it('leaves Snap alone when the grid is hidden', () => {
    useUIStore.getState().toggleGrid();
    useUIStore.getState().toggleGrid();
    expect(useUIStore.getState()).toMatchObject({ showGrid: false, snapToGrid: true });
  });

  it('keeps Snap off across hide/show once the user turned it off', () => {
    const ui = useUIStore.getState();
    ui.toggleGrid();
    ui.toggleSnapToGrid();
    ui.toggleGrid();
    ui.toggleGrid();
    expect(useUIStore.getState()).toMatchObject({ showGrid: true, snapToGrid: false });
  });

  it('keeps a Snap choice made before the grid was ever shown', () => {
    const ui = useUIStore.getState();
    ui.toggleSnapToGrid();
    ui.toggleSnapToGrid();
    ui.toggleGrid();
    expect(useUIStore.getState()).toMatchObject({ showGrid: true, snapToGrid: false });
  });

  it('keeps Snap on across hide/show once the user turned it on', () => {
    const ui = useUIStore.getState();
    ui.toggleSnapToGrid();
    ui.toggleGrid();
    ui.toggleGrid();
    ui.toggleGrid();
    expect(useUIStore.getState()).toMatchObject({ showGrid: true, snapToGrid: true });
  });
});
