import type { Meta, StoryObj } from '@storybook/react-vite';
import { StartScreen } from './StartScreen';

const meta: Meta<typeof StartScreen> = {
  component: StartScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof StartScreen>;

/** A first visit to photonamous.com: Try it now opens the three steps and Continue with Google (the GetStarted stories). */
export const FirstVisit: Story = {
  args: {
    choices: ['google-drive'],
    offer: null,
    connecting: null,
    error: null,
    busyKind: null,
    receiving: false,
    onChoose: () => undefined,
    onReconnect: () => undefined,
    onTakeOver: () => undefined,
  },
};

/** Someone who has signed in here before. */
export const Returning: Story = {
  args: { ...FirstVisit.args, offer: { kind: 'google-drive', label: 'Google Drive', automatic: false } },
};

/** A development build also offers libraries on this computer. */
export const Development: Story = { args: { ...FirstVisit.args, choices: ['google-drive', 'browser', 'local-folder'] } };

export const Connecting: Story = { args: { ...FirstVisit.args, connecting: 'google-drive' } };

export const Failed: Story = { args: { ...FirstVisit.args, error: 'The library could not be opened: Google refused the token.' } };

/** The library is open in another tab of this browser. */
export const OpenElsewhere: Story = { args: { ...Returning.args, busyKind: 'google-drive' } };

/** A production build without a Google client ID has no way in. */
export const NoSignIn: Story = { args: { ...FirstVisit.args, choices: [] } };
