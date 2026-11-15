import type { Meta, StoryObj } from '@storybook/react-vite';
import { WebGL2Warning } from './WebGL2Warning';

const meta: Meta<typeof WebGL2Warning> = {
  component: WebGL2Warning,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof WebGL2Warning>;

export const Default: Story = {};
