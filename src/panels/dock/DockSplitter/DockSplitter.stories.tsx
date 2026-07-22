import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { DockSplitter } from './DockSplitter';

const meta: Meta<typeof DockSplitter> = {
  component: DockSplitter,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof DockSplitter>;

const pane = (flex: number): React.CSSProperties => ({
  flex,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--color-bg-primary)',
  color: 'var(--color-text-secondary)',
  minWidth: 0,
  minHeight: 0,
});

function SplitDemo({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  const [firstFlex, setFirstFlex] = useState(1);
  const [start, setStart] = useState(1);
  const isRow = orientation === 'vertical';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isRow ? 'row' : 'column',
        width: 360,
        height: 240,
        border: '1px solid var(--color-border)',
      }}
    >
      <div style={pane(firstFlex)}>Pane A</div>
      <DockSplitter
        orientation={orientation}
        label="Resize panels"
        onDragStart={() => setStart(firstFlex)}
        onDrag={(delta) => setFirstFlex(Math.max(0.2, start + delta / 180))}
      />
      <div style={pane(Math.max(0.2, 2 - firstFlex))}>Pane B</div>
    </div>
  );
}

export const Vertical: Story = {
  render: () => <SplitDemo orientation="vertical" />,
};

export const Horizontal: Story = {
  render: () => <SplitDemo orientation="horizontal" />,
};
