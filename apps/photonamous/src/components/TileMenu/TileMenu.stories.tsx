import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { TileMenu } from './TileMenu';

const meta: Meta<typeof TileMenu> = {
  component: TileMenu,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof TileMenu>;

const ids = fakeAssetIds(4);

export const Default: Story = { args: { x: 40, y: 40, orderedIds: ids, onClose: () => undefined } };
