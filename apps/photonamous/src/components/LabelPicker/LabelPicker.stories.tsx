import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ColorLabel } from '@lopsy/photos-core/library/types';
import { LabelPicker } from './LabelPicker';

const meta: Meta<typeof LabelPicker> = {
  component: LabelPicker,
};

export default meta;
type Story = StoryObj<typeof LabelPicker>;

export const Default: Story = {
  render: function Story() {
    const [label, setLabel] = useState<ColorLabel | null>('green');
    return <LabelPicker value={label} onChange={setLabel} />;
  },
};
export const None: Story = { args: { value: null, onChange: () => undefined } };
