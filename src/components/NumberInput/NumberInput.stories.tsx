import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { NumberInput } from './NumberInput';

const meta: Meta<typeof NumberInput> = {
  component: NumberInput,
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

function Stateful(args: React.ComponentProps<typeof NumberInput>) {
  const [value, setValue] = useState(args.value);
  return <NumberInput {...args} value={value} onChange={setValue} />;
}

export const Default: Story = {
  args: { value: 42, label: 'Width' },
  render: (args) => <Stateful {...args} />,
};

export const WithSuffix: Story = {
  args: { value: 100, min: 0, max: 400, label: 'Zoom', suffix: '%' },
  render: (args) => <Stateful {...args} />,
};

export const Fractional: Story = {
  args: { value: 0.5, min: 0, max: 10, step: 0.1, label: 'Flow' },
  render: (args) => <Stateful {...args} />,
};
