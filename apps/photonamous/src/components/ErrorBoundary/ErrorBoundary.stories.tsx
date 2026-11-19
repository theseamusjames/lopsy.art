import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): never {
  throw new Error('No library is open');
}

const meta: Meta<typeof ErrorBoundary> = {
  component: ErrorBoundary,
};

export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

export const Caught: Story = { args: { children: <Broken /> } };
