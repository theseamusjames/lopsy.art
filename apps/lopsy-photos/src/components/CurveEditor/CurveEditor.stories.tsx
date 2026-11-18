import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { CurvePoint } from '@lopsy/photos-core/library/recipe';
import { CurveEditor } from './CurveEditor';

const meta: Meta<typeof CurveEditor> = {
  component: CurveEditor,
};

export default meta;
type Story = StoryObj<typeof CurveEditor>;

export const Luminance: Story = {
  render: function Story() {
    const [points, setPoints] = useState<CurvePoint[]>([
      { x: 0, y: 0 },
      { x: 0.3, y: 0.22 },
      { x: 0.7, y: 0.8 },
      { x: 1, y: 1 },
    ]);
    return (
      <div style={{ width: 260 }}>
        <CurveEditor label="Luminance curve" points={points} color="var(--color-text-primary)" onChange={setPoints} onCommit={setPoints} />
      </div>
    );
  },
};
