import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { ImportButton } from './ImportButton';

const meta: Meta<typeof ImportButton> = {
  component: ImportButton,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof ImportButton>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
