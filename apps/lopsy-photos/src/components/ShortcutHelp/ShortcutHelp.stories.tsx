import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { ShortcutHelp } from './ShortcutHelp';

const meta: Meta<typeof ShortcutHelp> = {
  component: ShortcutHelp,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof ShortcutHelp>;

export const Default: Story = {};
