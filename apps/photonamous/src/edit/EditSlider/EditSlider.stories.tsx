import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type CSSProperties } from 'react';
import { EditSlider, type EditSliderProps } from './EditSlider';

const meta: Meta<typeof EditSlider> = {
  component: EditSlider,
};

export default meta;
type Story = StoryObj<typeof EditSlider>;

function Controlled(props: Omit<EditSliderProps, 'value' | 'onChange' | 'onCommit'> & { readonly initial: number }) {
  const { initial, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <div style={{ '--slider-label-width': '84px', '--slider-value-width': '56px' } as CSSProperties}>
      <EditSlider {...rest} value={value} onChange={setValue} onCommit={setValue} />
    </div>
  );
}

const kelvin = {
  format: (v: number) => `${Math.round((5500 + v * 30) / 50) * 50} K`,
  parse: (text: string) => {
    const k = Number(text.trim().replace(/\s*k$/i, ''));
    return Number.isFinite(k) && k > 0 ? Math.round((k - 5500) / 30) : null;
  },
};

export const Exposure: Story = {
  render: () => <Controlled label="Exposure" initial={0.5} min={-5} max={5} step={0.01} defaultValue={0} unit="EV" />,
};

export const Contrast: Story = {
  render: () => <Controlled label="Contrast" initial={-12} min={-100} max={100} step={1} defaultValue={0} />,
};

export const Kelvin: Story = {
  render: () => <Controlled label="Temperature" initial={0} min={-100} max={100} step={1} defaultValue={0} {...kelvin} />,
};

export const Disabled: Story = {
  render: () => <Controlled label="Angle" initial={0} min={-45} max={45} step={0.1} defaultValue={0} unit="degrees" disabled />,
};
