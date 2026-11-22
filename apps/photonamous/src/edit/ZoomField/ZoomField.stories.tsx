import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ZoomField, type ZoomFieldProps } from './ZoomField';

const meta: Meta<typeof ZoomField> = {
  component: ZoomField,
};

export default meta;
type Story = StoryObj<typeof ZoomField>;

function Controlled({ initial, ...rest }: Omit<ZoomFieldProps, 'zoom' | 'onZoom'> & { readonly initial: number }) {
  const [zoom, setZoom] = useState(initial);
  return <ZoomField {...rest} zoom={zoom} onZoom={setZoom} />;
}

export const FullSize: Story = {
  render: () => <Controlled initial={1} />,
};

export const Fitted: Story = {
  render: () => <Controlled initial={0.37} hint="The whole photo fits. Type a zoom level from 10 to 400% and press Enter" />,
};

export const Disabled: Story = {
  render: () => <Controlled initial={1} isDisabled />,
};
