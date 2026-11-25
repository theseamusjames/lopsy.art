import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { Header } from './Header';

const meta: Meta<typeof Header> = {
  component: Header,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof Header>;

export const Default: Story = {};
