import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { splitSidesText } from '../edit-keys';
import { SplitView } from './SplitView';
import styles from './SplitView.stories.module.css';

const meta: Meta<typeof SplitView> = {
  component: SplitView,
};

export default meta;
type Story = StoryObj<typeof SplitView>;

/** A picture drawn as SVG: the same scene dark (before) and bright (after), so the sides are told apart at a glance. */
function scene(sky: string, ground: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320"><rect width="480" height="200" fill="${sky}"/><rect y="200" width="480" height="120" fill="${ground}"/><circle cx="360" cy="90" r="40" fill="#f4e3b0"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const BEFORE = scene('#3a4652', '#3b3a2c');
const AFTER = scene('#7fb2de', '#8a9a4c');

/** Over a stage as the Edit view's is: the edit underneath, the split over the whole picture. */
function Controlled({ isSwappedAtFirst }: { readonly isSwappedAtFirst: boolean }) {
  const [at, setAt] = useState(0.5);
  const [isSwapped, setIsSwapped] = useState(isSwappedAtFirst);
  return (
    <div>
      <div className={styles.stage}>
        <img className={styles.after} src={AFTER} alt="" />
        <SplitView
          imageBox={{ left: 0, top: 0, width: 480, height: 320 }}
          beforeSrc={BEFORE}
          at={at}
          onChange={setAt}
          isSwapped={isSwapped}
          onSwap={() => setIsSwapped((v) => !v)}
        />
      </div>
      <p className={styles.readout}>
        {splitSidesText(isSwapped)}; the divider at {Math.round(at * 100)} %.
      </p>
    </div>
  );
}

export const Default: Story = {
  render: () => <Controlled isSwappedAtFirst={false} />,
};

/** After double-clicking the divider (or Enter on it): the before on the right. */
export const Swapped: Story = {
  render: () => <Controlled isSwappedAtFirst />,
};
