import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { FloatingWindow } from '../dock-layout';
import { emptyLayout } from '../dock-layout';
import { useDockStore } from '../dock-store';
import { FloatingPanel } from './FloatingPanel';

const meta: Meta<typeof FloatingPanel> = {
  component: FloatingPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', width: '100%', height: 420, background: 'var(--color-bg-canvas)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FloatingPanel>;

function placeholder(panelId: string): ReactNode {
  return <div style={{ padding: 12, color: 'var(--color-text-secondary)' }}>{panelId} content</div>;
}

/** Seed the store so focus/resize actions operate on this window. */
function WithWindow({ window: win }: { window: FloatingWindow }) {
  useEffect(() => {
    useDockStore.setState({ layout: { ...emptyLayout(), floating: [win] }, drag: null });
  }, [win]);
  return <FloatingPanel window={win} renderPanel={placeholder} />;
}

export const SingleTab: Story = {
  render: () => (
    <WithWindow window={{ id: 'w-single', tabs: ['color'], activeTab: 'color', x: 60, y: 40, width: 260, height: 300 }} />
  ),
};

export const TwoTabs: Story = {
  render: () => (
    <WithWindow
      window={{ id: 'w-two', tabs: ['history', 'paths'], activeTab: 'history', x: 80, y: 30, width: 300, height: 320 }}
    />
  ),
};
