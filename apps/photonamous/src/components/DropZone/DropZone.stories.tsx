import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { DropZone } from './DropZone';

const meta: Meta<typeof DropZone> = {
  component: DropZone,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof DropZone>;

export const Default: Story = {};
