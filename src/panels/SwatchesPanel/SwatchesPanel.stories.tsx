import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { SwatchesPanel } from './SwatchesPanel';
import { useSwatchesStore } from '../../app/swatches-store';
import { DEFAULT_SWATCHES } from './swatches';
import type { Swatch } from './swatches';

const meta: Meta<typeof SwatchesPanel> = {
  component: SwatchesPanel,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 260, background: 'var(--color-bg-secondary)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SwatchesPanel>;

function WithSwatches({ swatches, children }: { swatches: readonly Swatch[]; children: React.ReactNode }) {
  useEffect(() => {
    useSwatchesStore.setState({ swatches });
  }, [swatches]);
  return <>{children}</>;
}

export const Default: Story = {
  render: () => (
    <WithSwatches swatches={DEFAULT_SWATCHES}>
      <SwatchesPanel />
    </WithSwatches>
  ),
};

export const Empty: Story = {
  render: () => (
    <WithSwatches swatches={[]}>
      <SwatchesPanel />
    </WithSwatches>
  ),
};

const sunset: Swatch[] = [
  [45, 27, 78], [94, 42, 110], [168, 50, 110], [230, 80, 90],
  [250, 130, 70], [255, 190, 90], [255, 230, 160],
].map(([r, g, b]) => ({ color: { r: r!, g: g!, b: b!, a: 1 }, name: '' }));

export const ExtractedPalette: Story = {
  render: () => (
    <WithSwatches swatches={[...DEFAULT_SWATCHES, ...sunset]}>
      <SwatchesPanel />
    </WithSwatches>
  ),
};
