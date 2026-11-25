import type { Meta, StoryObj } from '@storybook/react-vite';
import { fakeAssetIds, withFakeLibrary } from '../../stories/fake-library';
import { Preview } from './Preview';

const meta: Meta<typeof Preview> = {
  component: Preview,
  decorators: [withFakeLibrary, (Story) => <div style={{ width: 480, height: 320, display: 'flex' }}><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof Preview>;

const [first] = fakeAssetIds(1);

export const Fit: Story = { args: { itemId: first ?? '' } };
