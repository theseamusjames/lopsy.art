import type { Meta, StoryObj } from '@storybook/react-vite';
import { LiquifyPanel } from './LiquifyPanel';
import { useUIStore } from '../../app/ui-store';
import { createDisplacementMap, defaultLiquifySettings } from '../../tools/liquify/liquify';

/** Seed the Zustand store with a dummy session before rendering. */
function withLiquifySession(Story: React.ComponentType) {
  const width = 400;
  const height = 300;
  const pixels = new Uint8ClampedArray(width * height * 4);
  useUIStore.setState({
    liquify: {
      layerId: 'story-layer',
      layerWidth: width,
      layerHeight: height,
      originalPixels: pixels,
      displacementMap: createDisplacementMap(width, height),
      settings: defaultLiquifySettings(),
      isPainting: false,
      lastPaintPoint: null,
    },
  });
  return <Story />;
}

const meta: Meta<typeof LiquifyPanel> = {
  component: LiquifyPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [withLiquifySession],
};

export default meta;
type Story = StoryObj<typeof LiquifyPanel>;

export const Default: Story = {};

export const TwirlMode: Story = {
  decorators: [
    (Story) => {
      const width = 400;
      const height = 300;
      const pixels = new Uint8ClampedArray(width * height * 4);
      useUIStore.setState({
        liquify: {
          layerId: 'story-layer',
          layerWidth: width,
          layerHeight: height,
          originalPixels: pixels,
          displacementMap: createDisplacementMap(width, height),
          settings: { ...defaultLiquifySettings(), mode: 'twirl-cw' },
          isPainting: false,
          lastPaintPoint: null,
        },
      });
      return <Story />;
    },
  ],
};
