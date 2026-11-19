import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { ImportStrip } from './ImportStrip';

const meta: Meta<typeof ImportStrip> = {
  component: ImportStrip,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof ImportStrip>;

export const Default: Story = {};
