import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { DockTabs } from './DockTabs';

const meta: Meta<typeof DockTabs> = {
  component: DockTabs,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 300, height: 260, display: 'flex', border: '1px solid var(--color-border)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DockTabs>;

function placeholder(panelId: string): ReactNode {
  return <div style={{ padding: 12, color: 'var(--color-text-secondary)' }}>{panelId} content</div>;
}

export const SingleTab: Story = {
  args: {
    groupId: 'story-single',
    tabs: ['color'],
    activeTab: 'color',
    renderPanel: placeholder,
  },
};

export const ThreeTabs: Story = {
  args: {
    groupId: 'story-three',
    tabs: ['navigator', 'color', 'layers'],
    activeTab: 'color',
    renderPanel: placeholder,
  },
};

export const Floating: Story = {
  args: {
    groupId: 'story-floating',
    tabs: ['history', 'paths'],
    activeTab: 'history',
    variant: 'floating',
    renderPanel: placeholder,
  },
};
