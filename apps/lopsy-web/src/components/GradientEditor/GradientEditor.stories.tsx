import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { GradientEditor } from './GradientEditor';
import type { GradientStop } from '../../tools/gradient/gradient';

const meta: Meta<typeof GradientEditor> = {
  component: GradientEditor,
};

export default meta;
type Story = StoryObj<typeof GradientEditor>;

function Stateful(initial: readonly GradientStop[]) {
  const [stops, setStops] = useState<readonly GradientStop[]>(initial);
  const [selected, setSelected] = useState(0);
  return (
    <div style={{ width: 360 }}>
      <GradientEditor
        stops={stops}
        selectedIndex={selected}
        onStopsChange={setStops}
        onSelectStop={setSelected}
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
