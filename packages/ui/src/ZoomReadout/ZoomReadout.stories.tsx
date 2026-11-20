import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ZoomReadout } from './ZoomReadout';

const meta: Meta<typeof ZoomReadout> = {
  component: ZoomReadout,
  args: { zoom: 0.46 },
};

export default meta;
type Story = StoryObj<typeof ZoomReadout>;

function StatefulReadout(args: React.ComponentProps<typeof ZoomReadout>) {
  const [zoom, setZoom] = useState(args.zoom);
  return <ZoomReadout {...args} zoom={zoom} onZoom={setZoom} onReset={() => setZoom(1)} />;
}

/** Drag left or right on it, double-click it, or focus it and press Enter or an arrow key. */
export const Default: Story = {
  render: (args) => <StatefulReadout {...args} />,
};

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => <StatefulReadout {...args} />,
};
