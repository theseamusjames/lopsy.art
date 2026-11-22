import type { Meta, StoryObj } from '@storybook/react-vite';
import { GetStarted } from './GetStarted';

const meta: Meta<typeof GetStarted> = {
  component: GetStarted,
  parameters: { layout: 'fullscreen' },
  args: { connecting: false, error: null, onSignIn: () => undefined, onClose: () => undefined },
};

export default meta;
type Story = StoryObj<typeof GetStarted>;

/** What "Try it now" opens: three steps, then Sign in with Google. */
export const Steps: Story = {};

/** Google's sign-in window is open. */
export const Connecting: Story = { args: { connecting: true } };

export const Failed: Story = { args: { error: 'The library could not be opened: Google refused the token.' } };
