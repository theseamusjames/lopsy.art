import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { Sidebar } from './Sidebar';

const meta: Meta<typeof Sidebar> = {
  component: Sidebar,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

export const Default: Story = {};
