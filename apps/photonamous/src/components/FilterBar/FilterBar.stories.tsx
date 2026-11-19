import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { FilterBar } from './FilterBar';

const meta: Meta<typeof FilterBar> = {
  component: FilterBar,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof FilterBar>;

export const Default: Story = {};
