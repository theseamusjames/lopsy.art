import { useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextInputSink } from './TextInputSink';

const meta: Meta<typeof TextInputSink> = {
  component: TextInputSink,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof TextInputSink>;

/** Renders nothing until a text layer is being edited; then an invisible textarea. */
export const Default: Story = {
  render: () => {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div ref={ref} style={{ position: 'relative', width: 400, height: 300 }}>
        <TextInputSink containerRef={ref} />
      </div>
    );
  },
};
