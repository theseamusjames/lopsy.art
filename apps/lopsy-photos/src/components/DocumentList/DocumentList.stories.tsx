import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { DocumentList } from './DocumentList';

const meta: Meta<typeof DocumentList> = {
  component: DocumentList,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof DocumentList>;

const [first] = fakeAssetIds(1);

export const NoDocuments: Story = { args: { assetId: first ?? '' } };
