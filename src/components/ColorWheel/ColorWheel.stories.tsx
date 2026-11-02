import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColorWheel } from './ColorWheel';

const meta: Meta<typeof ColorWheel> = {
  component: ColorWheel,
};

export default meta;
type Story = StoryObj<typeof ColorWheel>;

function Stateful({ hue: initialHue, saturation: initialSaturation, isActive }: {
  hue: number;
  saturation: number;
  isActive?: boolean;
}) {
  const [value, setValue] = useState({ hue: initialHue, saturation: initialSaturation });
  return (
    <div style={{ width: 120 }}>
      <ColorWheel
        label="Midtones"
        hue={value.hue}
        saturation={value.saturation}
        isActive={isActive}
        onChange={(hue, saturation) => setValue({ hue, saturation })}
      />
    </div>
  );
}

export const Neutral: Story = {
  render: () => <Stateful hue={0} saturation={0} />,
};

export const Teal: Story = {
  render: () => <Stateful hue={190} saturation={45} />,
};

export const FullOrangeActive: Story = {
  render: () => <Stateful hue={30} saturation={100} isActive />,
};
