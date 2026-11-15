import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColorSwatch } from './ColorSwatch';

const meta: Meta<typeof ColorSwatch> = {
  component: ColorSwatch,
};

export default meta;
type Story = StoryObj<typeof ColorSwatch>;

export const Default: Story = {
  args: { color: { r: 220, g: 80, b: 90, a: 1 } },
};

export const Small: Story = {
  args: { color: { r: 80, g: 140, b: 220, a: 1 }, size: 'sm' },
};

export const Large: Story = {
  args: { color: { r: 50, g: 180, b: 120, a: 1 }, size: 'lg' },
};

export const Transparent: Story = {
  args: { color: { r: 255, g: 128, b: 0, a: 0.35 } },
};

export const Active: Story = {
  args: { color: { r: 255, g: 215, b: 0, a: 1 }, isActive: true },
};

export const Grid: Story = {
  render: () => {
    const palette = [
      { r: 255, g: 255, b: 255, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 220, g: 50, b: 50, a: 1 },
      { r: 50, g: 160, b: 220, a: 1 },
      { r: 70, g: 170, b: 90, a: 1 },
      { r: 255, g: 200, b: 0, a: 1 },
    ];
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        {palette.map((c, i) => (
          <ColorSwatch key={i} color={c} />
        ))}
      </div>
    );
  },
};
