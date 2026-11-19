import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { Rating } from '@lopsy/photos-core/library/types';
import { Stars } from './Stars';

const meta: Meta<typeof Stars> = {
  component: Stars,
  args: { rating: 3 },
};

export default meta;
type Story = StoryObj<typeof Stars>;

export const ReadOnly: Story = {};
export const Mixed: Story = { args: { rating: 0, mixed: true } };
export const Large: Story = { args: { rating: 4, size: 18 } };
export const Editable: Story = {
  render: function Story() {
    const [rating, setRating] = useState<Rating>(2);
    return <Stars rating={rating} size={18} onChange={setRating} />;
  },
};
