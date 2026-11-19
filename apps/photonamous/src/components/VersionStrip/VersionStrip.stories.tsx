import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { VersionStrip } from './VersionStrip';

const meta: Meta<typeof VersionStrip> = {
  component: VersionStrip,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof VersionStrip>;

const [first] = fakeAssetIds(1);

export const Default: Story = { args: { itemId: first ?? '' } };
