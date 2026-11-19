import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { PhotoGrid } from './PhotoGrid';

const meta: Meta<typeof PhotoGrid> = {
  component: PhotoGrid,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof PhotoGrid>;

const ids = fakeAssetIds(24);

export const Default: Story = { args: { orderedIds: ids }, decorators: [(Story) => <div style={{ height: 520, display: 'flex' }}><Story /></div>] };
