import type { Meta, StoryObj } from '@storybook/react-vite';
import { MarqueeRegionModal } from './MarqueeRegionModal';

const meta: Meta<typeof MarqueeRegionModal> = {
  component: MarqueeRegionModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof MarqueeRegionModal>;

export const Rectangle: Story = {
  args: {
    shape: 'rect',
    initialFrom: { x: 40, y: 60 },
    initialTo: { x: 140, y: 160 },
    onConfirm: (from, to) => console.log('confirm', from, to),
    onCancel: () => console.log('cancel'),
  },
};

export const Ellipse: Story = {
  args: {
    ...Rectangle.args,
    shape: 'ellipse',
  },
};
