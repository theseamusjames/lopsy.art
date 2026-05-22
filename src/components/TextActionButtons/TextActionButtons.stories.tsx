import { useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextActionButtons } from './TextActionButtons';

const meta: Meta<typeof TextActionButtons> = {
  component: TextActionButtons,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof TextActionButtons>;

export const Default: Story = {
  render: () => {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div ref={ref} style={{ position: 'relative', width: 400, height: 300 }}>
        <TextActionButtons containerRef={ref} />
      </div>
    );
  },
};
