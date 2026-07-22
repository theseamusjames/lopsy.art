import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { DockLayout } from '../dock-layout';
import { createDefaultLayout, createTabGroup, emptyLayout } from '../dock-layout';
import { useDockStore } from '../dock-store';
import { DockHost } from './DockHost';

const meta: Meta<typeof DockHost> = {
  component: DockHost,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ width: '100%', height: 460, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DockHost>;

function placeholder(panelId: string): ReactNode {
  return <div style={{ padding: 12, color: 'var(--color-text-secondary)' }}>{panelId} content</div>;
}

const canvas = (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-canvas)', color: 'var(--color-text-secondary)' }}>
    canvas
  </div>
);

function WithLayout({ layout }: { layout: DockLayout }) {
  useEffect(() => {
    useDockStore.setState({ layout, drag: null });
  }, [layout]);
  return <DockHost renderPanel={placeholder}>{canvas}</DockHost>;
}

export const DefaultLayout: Story = {
  render: () => <WithLayout layout={createDefaultLayout()} />,
};

export const AllFourEdges: Story = {
  render: () => {
    const base = emptyLayout();
    const layout: DockLayout = {
      ...base,
      docks: {
        left: createTabGroup(['navigator']),
        right: {
          kind: 'split',
          id: 'story-right',
          direction: 'column',
          children: [createTabGroup(['color']), createTabGroup(['layers'])],
          sizes: [0.4, 0.6],
        },
        top: createTabGroup(['info']),
        bottom: createTabGroup(['history', 'paths']),
      },
    };
    return <WithLayout layout={layout} />;
  },
};

export const WithFloatingWindow: Story = {
  render: () => {
    const layout: DockLayout = {
      ...createDefaultLayout(),
      floating: [{ id: 'w1', tabs: ['channels'], activeTab: 'channels', x: 220, y: 90, width: 260, height: 240 }],
    };
    return <WithLayout layout={layout} />;
  },
};
