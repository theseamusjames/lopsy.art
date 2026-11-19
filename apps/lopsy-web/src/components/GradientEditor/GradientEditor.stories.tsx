import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { GradientEditor } from './GradientEditor';
import type { GradientStop } from '../../tools/gradient/gradient';

const meta: Meta<typeof GradientEditor> = {
  component: GradientEditor,
};

export default meta;
type Story = StoryObj<typeof GradientEditor>;

function Stateful(initial: readonly GradientStop[], barBackground?: string, label?: string) {
  const [stops, setStops] = useState<readonly GradientStop[]>(initial);
  const [selected, setSelected] = useState(0);
  return (
    <div style={{ width: 360 }}>
      <GradientEditor
        stops={stops}
        selectedIndex={selected}
        onStopsChange={setStops}
        onSelectStop={setSelected}
        barBackground={barBackground}
        label={label}
      />
    </div>
  );
}

export const BlackToWhite: Story = {
  render: () =>
    Stateful([
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ]),
};

export const Rainbow: Story = {
  render: () =>
    Stateful([
      { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: 0.33, color: { r: 255, g: 255, b: 0, a: 1 } },
      { position: 0.66, color: { r: 0, g: 180, b: 255, a: 1 } },
      { position: 1, color: { r: 180, g: 0, b: 255, a: 1 } },
    ]),
};

export const TransparentFade: Story = {
  render: () =>
    Stateful([
      { position: 0, color: { r: 255, g: 120, b: 50, a: 1 } },
      { position: 1, color: { r: 255, g: 120, b: 50, a: 0 } },
    ]),
};

/** Color Grading's Tone bar: stops placed along a fixed black-to-white axis. */
export const ToneAxis: Story = {
  render: () =>
    Stateful(
      [
        { position: 0, color: { r: 20, g: 60, b: 200, a: 1 } },
        { position: 0.5, color: { r: 128, g: 128, b: 128, a: 1 } },
        { position: 1, color: { r: 255, g: 170, b: 60, a: 1 } },
      ],
      'linear-gradient(to right, #000, #fff)',
      'Tone',
    ),
};
