import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Info } from 'lucide-react';
import { IconButton } from './IconButton';

const meta: Meta<typeof IconButton> = {
  component: IconButton,
  args: { label: 'Details (I)', icon: <Info size={16} />, onClick: () => undefined },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {};
export const Active: Story = { args: { active: true } };
export const Toggle: Story = {
  render: function Story(args) {
    const [isOn, setIsOn] = useState(true);
    return <IconButton {...args} pressed={isOn} onClick={() => setIsOn((on) => !on)} />;
  },
};
export const Small: Story = { args: { size: 'sm' } };
export const Disabled: Story = { args: { disabled: true } };
export const Unavailable: Story = {
  args: {
    label: 'Edit in Lopsy',
    unavailable: 'This photo is 17504 × 3440 pixels, larger than Lopsy can open on this device (16382 on a side).',
  },
};
