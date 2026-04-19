import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Slider } from './Slider';

const meta: Meta<typeof Slider> = {
  component: Slider,
  args: {
    min: 0,
    max: 100,
    step: 1,
    showValue: true,
  },
};

export default meta;
type Story = StoryObj<typeof Slider>;

function StatefulSlider(args: React.ComponentProps<typeof Slider>) {
  const [value, setValue] = useState(args.value);
  return <Slider {...args} value={value} onChange={setValue} />;
}

export const Default: Story = {
  args: { value: 50, label: 'Size' },
  render: (args) => <StatefulSlider {...args} />,
};

export const WithSuffix: Story = {
  args: { value: 75, label: 'Opacity', suffix: '%' },
  render: (args) => <StatefulSlider {...args} />,
};

export const Logarithmic: Story = {
  args: { value: 100, min: 1, max: 1000, scale: 'log', label: 'Radius', suffix: 'px' },
  render: (args) => <StatefulSlider {...args} />,
};

export const WithoutValue: Story = {
  args: { value: 30, showValue: false, label: 'Hardness' },
  render: (args) => <StatefulSlider {...args} />,
};

export const FractionalStep: Story = {
  args: { value: 1.5, min: 0, max: 10, step: 0.1, label: 'Flow' },
  render: (args) => <StatefulSlider {...args} />,
};
