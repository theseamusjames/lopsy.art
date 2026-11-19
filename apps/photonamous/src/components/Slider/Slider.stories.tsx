import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Slider } from './Slider';

const meta: Meta<typeof Slider> = {
  component: Slider,
};

export default meta;
type Story = StoryObj<typeof Slider>;

function Controlled({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState(0.35);
  return (
    <div style={{ width: 280 }}>
      <Slider
        label="Exposure"
        value={value}
        min={-5}
        max={5}
        step={0.05}
        defaultValue={0}
        onChange={setValue}
        onCommit={setValue}
        isDisabled={disabled}
        display={{ format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`, parse: (t) => (Number.isFinite(Number(t)) ? Number(t) : null) }}
      />
    </div>
  );
}

export const Default: Story = { render: () => <Controlled /> };
export const Disabled: Story = { render: () => <Controlled disabled /> };
