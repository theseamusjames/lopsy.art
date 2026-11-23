import type { Meta, StoryObj } from '@storybook/react-vite';
import { Wordmark } from './Wordmark';

const meta: Meta<typeof Wordmark> = {
  component: Wordmark,
  args: { size: 'header' },
};

export default meta;
type Story = StoryObj<typeof Wordmark>;

/** As in the header: the one-colour mark, 120 × 21. */
export const Header: Story = {};

/** As on the start screen: the colour mark, as wide as its column, up to 560 px. */
export const Start: Story = { args: { size: 'start' } };
