import type { Meta, StoryObj } from '@storybook/react-vite';
import { BrandLinks } from './BrandLinks';

const meta: Meta<typeof BrandLinks> = {
  component: BrandLinks,
};

export default meta;
type Story = StoryObj<typeof BrandLinks>;

export const Default: Story = {};
