import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import type { SplitNode } from '../dock-layout';
import { createTabGroup } from '../dock-layout';
import { DockZone } from './DockZone';

const meta: Meta<typeof DockZone> = {
  component: DockZone,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 340, height: 300, display: 'flex', border: '1px solid var(--color-border)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DockZone>;

function placeholder(panelId: string): ReactNode {
  return <div style={{ padding: 12, color: 'var(--color-text-secondary)' }}>{panelId} content</div>;
}

export const SingleGroup: Story = {
  args: {
    node: createTabGroup(['color']),
    renderPanel: placeholder,
  },
};

export const ColumnSplit: Story = {
  args: {
    node: {
      kind: 'split',
      id: 'story-col',
      direction: 'column',
      children: [createTabGroup(['color']), createTabGroup(['layers'])],
      sizes: [0.4, 0.6],
    } satisfies SplitNode,
    renderPanel: placeholder,
  },
};

export const NestedSplit: Story = {
  args: {
    node: {
      kind: 'split',
      id: 'story-outer',
      direction: 'row',
      children: [
        createTabGroup(['navigator']),
        {
          kind: 'split',
          id: 'story-inner',
          direction: 'column',
          children: [createTabGroup(['color', 'info']), createTabGroup(['layers'])],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.35, 0.65],
    } satisfies SplitNode,
    renderPanel: placeholder,
  },
};
