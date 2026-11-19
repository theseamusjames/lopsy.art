import type { Meta, StoryObj } from '@storybook/react-vite';
import { StartScreen } from './StartScreen';

const meta: Meta<typeof StartScreen> = {
  component: StartScreen,
};

export default meta;
type Story = StoryObj<typeof StartScreen>;

export const Choose: Story = {
  args: {
    choices: ['google-drive', 'local-folder', 'browser'],
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
export const Connecting: Story = { args: { ...Choose.args, connecting: 'browser' } };
export const Failed: Story = { args: { ...Choose.args, error: 'The folder could not be opened.' } };
