import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { useUi } from '../../app/store';
import { DeleteDialog } from './DeleteDialog';

const meta: Meta<typeof DeleteDialog> = {
  component: DeleteDialog,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof DeleteDialog>;

const ids = fakeAssetIds(2);

export const TwoPhotos: Story = {
  render: () => {
    useUi.setState({ deleteIds: ids });
    return <DeleteDialog />;
  },
};
