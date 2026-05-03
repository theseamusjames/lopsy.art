import type { Meta, StoryObj } from '@storybook/react-vite';
import { SwatchesPanel } from './SwatchesPanel';
import { useSwatchesStore } from '../../app/store/swatches-store';

const meta: Meta<typeof SwatchesPanel> = {
  component: SwatchesPanel,
  decorators: [
    (Story) => {
      // Reset store to defaults so stories are isolated
      useSwatchesStore.setState({
        swatches: [
          { id: '1', name: 'Black', color: { r: 0, g: 0, b: 0, a: 1 } },
          { id: '2', name: 'White', color: { r: 255, g: 255, b: 255, a: 1 } },
          { id: '3', name: 'Red', color: { r: 220, g: 38, b: 38, a: 1 } },
          { id: '4', name: 'Blue', color: { r: 37, g: 99, b: 235, a: 1 } },
          { id: '5', name: 'Green', color: { r: 22, g: 163, b: 74, a: 1 } },
        ],
      });
      return (
        <div style={{ width: 260, background: '#1e1e1e', padding: 8 }}>
          <Story />
        </div>
      );
    },
  ],
};

export default meta;

type Story = StoryObj<typeof SwatchesPanel>;

export const Default: Story = {};

export const Empty: Story = {
  decorators: [
    (Story) => {
      useSwatchesStore.setState({ swatches: [] });
      return (
        <div style={{ width: 260, background: '#1e1e1e', padding: 8 }}>
          <Story />
        </div>
      );
    },
  ],
};

export const ManySwatches: Story = {
  decorators: [
    (Story) => {
      useSwatchesStore.setState({
        swatches: Array.from({ length: 24 }, (_, i) => ({
          id: `s${i}`,
          name: `Color ${i + 1}`,
          color: { r: (i * 17) % 256, g: (i * 41) % 256, b: (i * 97) % 256, a: 1 },
        })),
      });
      return (
        <div style={{ width: 260, background: '#1e1e1e', padding: 8 }}>
          <Story />
        </div>
      );
    },
  ],
};
