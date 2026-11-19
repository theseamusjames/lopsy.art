import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { GridToolbar } from './GridToolbar';

const meta: Meta<typeof GridToolbar> = {
  component: GridToolbar,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof GridToolbar>;

const ids = fakeAssetIds(24);

export const Default: Story = { args: { orderedIds: ids } };
