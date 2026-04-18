import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CurveEditor } from './CurveEditor';
import { IDENTITY_POINTS, type CurvePoint } from '../../filters/curves';

const meta: Meta<typeof CurveEditor> = {
  component: CurveEditor,
};

export default meta;
type Story = StoryObj<typeof CurveEditor>;

function Stateful(initial: readonly CurvePoint[]) {
  const [points, setPoints] = useState<readonly CurvePoint[]>(initial);
  return <CurveEditor points={points} onChange={setPoints} />;
}

export const Identity: Story = {
  render: () => Stateful(IDENTITY_POINTS),
};

export const SCurve: Story = {
  render: () =>
    Stateful([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.15 },
      { x: 0.75, y: 0.85 },
      { x: 1, y: 1 },
    ]),
};

export const Inverted: Story = {
  render: () =>
    Stateful([
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]),
};
