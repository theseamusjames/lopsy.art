import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Color } from '../../types';
import { ColorPicker } from './ColorPicker';

const meta: Meta<typeof ColorPicker> = {
  component: ColorPicker,
};

export default meta;
type Story = StoryObj<typeof ColorPicker>;

function Stateful({ color: initial }: { color: Color }) {
  const [color, setColor] = useState<Color>(initial);
  return (
    <div style={{ width: 260 }}>
      <ColorPicker color={color} onChange={setColor} />
    </div>
  );
}

export const Red: Story = {
  render: () => <Stateful color={{ r: 220, g: 50, b: 50, a: 1 }} />,
};

export const Blue: Story = {
  render: () => <Stateful color={{ r: 50, g: 120, b: 220, a: 1 }} />,
};

export const TranslucentYellow: Story = {
  render: () => <Stateful color={{ r: 255, g: 215, b: 0, a: 0.5 }} />,
};
