import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import type { DockDragState } from '../dock-store';
import { useDockStore } from '../dock-store';
import { DropIndicator } from './DropIndicator';

const meta: Meta<typeof DropIndicator> = {
  component: DropIndicator,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', width: '100%', height: 360, background: 'var(--color-bg-canvas)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DropIndicator>;

/** Push a synthetic drag into the store so the overlay has something to draw. */
function WithDrag({ drag }: { drag: DockDragState }) {
  useEffect(() => {
    useDockStore.setState({ drag });
    return () => useDockStore.setState({ drag: null });
  }, [drag]);
  return <DropIndicator />;
}

export const EdgeDock: Story = {
  render: () => (
    <WithDrag
      drag={{
        source: { kind: 'tab', panelId: 'color', groupId: 'g1' },
        pointer: { x: 40, y: 180 },
        target: { kind: 'edge', side: 'left' },
        indicator: { x: 0, y: 0, width: 220, height: 360 },
        title: 'Color',
        showGhost: true,
      }}
    />
  ),
};

export const TabMerge: Story = {
  render: () => (
    <WithDrag
      drag={{
        source: { kind: 'tab', panelId: 'layers', groupId: 'g1' },
        pointer: { x: 360, y: 150 },
        target: { kind: 'group', groupId: 'g2', region: 'center' },
        indicator: { x: 300, y: 60, width: 240, height: 220 },
        title: 'Layers',
        showGhost: true,
      }}
    />
  ),
};
