import type { Meta, StoryObj } from '@storybook/react-vite';
import { withFakeLibrary } from '../../stories/fake-library';
import { SignInPrompt } from './SignInPrompt';

const meta: Meta<typeof SignInPrompt> = {
  component: SignInPrompt,
  decorators: [withFakeLibrary],
};

export default meta;
type Story = StoryObj<typeof SignInPrompt>;

/** The single view, waiting for the full-size picture. */
export const Default: Story = { args: { sentence: 'Reconnect Google Drive to load this photo at full size.' } };

/** The Edit view, waiting for the original. */
export const Edit: Story = { args: { sentence: 'Reconnect Google Drive to get the original and edit this photo.', size: 'md' } };
