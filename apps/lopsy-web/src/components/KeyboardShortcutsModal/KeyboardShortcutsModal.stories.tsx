import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';

const meta: Meta<typeof KeyboardShortcutsModal> = {
  component: KeyboardShortcutsModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof KeyboardShortcutsModal>;

export const Default: Story = {
  args: { onClose: () => console.log('close') },
};
