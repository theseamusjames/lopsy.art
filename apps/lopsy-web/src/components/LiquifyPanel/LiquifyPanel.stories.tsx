import type { Meta, StoryObj } from '@storybook/react-vite';
import { LiquifyPanel } from './LiquifyPanel';
import { useUIStore } from '../../app/ui-store';
import { defaultLiquifySettings } from '../../tools/liquify/liquify';

function withLiquifySession(Story: React.ComponentType) {
  useUIStore.setState({
    liquify: {
      layerId: 'story-layer',
      layerWidth: 400,
      layerHeight: 300,
      settings: defaultLiquifySettings(),
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
      useUIStore.setState({
        liquify: {
          layerId: 'story-layer',
          layerWidth: 400,
          layerHeight: 300,
          settings: { ...defaultLiquifySettings(), mode: 'twirl-cw' },
        },
      });
      return <Story />;
    },
  ],
};
