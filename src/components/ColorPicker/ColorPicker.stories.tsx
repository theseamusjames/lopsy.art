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

export const WithoutHexField: Story = {
  render: () => {
    function Panel() {
      const [color, setColor] = useState<Color>({ r: 59, g: 20, b: 99, a: 1 });
      return (
        <div style={{ width: 260 }}>
          <ColorPicker color={color} onChange={setColor} showHex={false} />
        </div>
      );
    }
    return <Panel />;
  },
};

const STOPS: readonly Color[] = [
  { r: 21, g: 19, b: 15, a: 1 },
  { r: 2, g: 103, b: 253, a: 1 },
  { r: 234, g: 227, b: 209, a: 1 },
];

/** A host that swaps the color under the picker, like selecting gradient stops:
 *  the cursors and hex field follow the selected color immediately. */
function StopSwitcher() {
  const [stops, setStops] = useState<readonly Color[]>(STOPS);
  const [selected, setSelected] = useState(0);
  const color = stops[selected] ?? STOPS[0]!;
  return (
    <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {stops.map((stop, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSelected(i)}
            aria-pressed={i === selected}
            style={{ width: 32, height: 20, background: `rgb(${stop.r},${stop.g},${stop.b})` }}
          />
        ))}
      </div>
      <ColorPicker
        color={color}
        onChange={(c) => setStops(stops.map((s, i) => (i === selected ? c : s)))}
      />
    </div>
  );
}

export const SwitchingStops: Story = {
  render: () => <StopSwitcher />,
};
