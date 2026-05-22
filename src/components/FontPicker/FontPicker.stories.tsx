import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FontPicker } from './FontPicker';

const meta: Meta<typeof FontPicker> = {
  component: FontPicker,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof FontPicker>;

export const Default: Story = {
  render: () => {
    const [font, setFont] = useState('Inter');
    return <FontPicker value={font} onChange={setFont} />;
  },
};

export const WithMonospace: Story = {
  render: () => {
    const [font, setFont] = useState('JetBrains Mono');
    return <FontPicker value={font} onChange={setFont} />;
  },
};
