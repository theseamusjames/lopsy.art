import { useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PathActionButtons } from './PathActionButtons';

const meta: Meta<typeof PathActionButtons> = {
  component: PathActionButtons,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof PathActionButtons>;

export const Default: Story = {
  render: () => {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div ref={ref} style={{ position: 'relative', width: 400, height: 300 }}>
        <PathActionButtons containerRef={ref} />
      </div>
    );
  },
};
