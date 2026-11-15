import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { TextColorControl } from './TextColorControl';
import type { Color } from '../../types';

const meta: Meta<typeof TextColorControl> = {
  component: TextColorControl,
};

export default meta;
type Story = StoryObj<typeof TextColorControl>;

const RED: Color = { r: 220, g: 50, b: 50, a: 1 };

function Interactive({ initial }: { initial: Color | null }) {
  const [color, setColor] = useState<Color | null>(initial);
  return (
    <TextColorControl
      color={color}
      pickerColor={color ?? RED}
      onChange={setColor}
    />
  );
}

export const Default: Story = {
  render: () => <Interactive initial={RED} />,
};

/** Text holding several colours shows "–" until a pick recolours it all. */
export const Mixed: Story = {
  render: () => <Interactive initial={null} />,
};

export const SemiTransparent: Story = {
  render: () => <Interactive initial={{ r: 40, g: 120, b: 220, a: 0.4 }} />,
};
