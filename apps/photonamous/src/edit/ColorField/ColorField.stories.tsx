import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ColorField } from './ColorField';
import styles from './ColorField.stories.module.css';

const meta: Meta<typeof ColorField> = {
  component: ColorField,
};

export default meta;
type Story = StoryObj<typeof ColorField>;

/** In a column as wide as the Edit panel's, at its right, so the enlarged field has the room it has there. */
function Controlled({ isDisabled = false }: { readonly isDisabled?: boolean }) {
  const [color, setColor] = useState({ hue: 210, saturation: 45 });
  return (
    <div className={styles.column}>
      <ColorField
        label="Shadows color"
        hue={color.hue}
        saturation={color.saturation}
        isDisabled={isDisabled}
        onChange={(hue, saturation) => setColor({ hue, saturation })}
        onCommit={(hue, saturation) => setColor({ hue, saturation })}
      />
      <p className={styles.readout}>
        Hue {color.hue}°, saturation {color.saturation} %
      </p>
    </div>
  );
}

export const Default: Story = {
  render: () => <Controlled />,
};

export const Disabled: Story = {
  render: () => <Controlled isDisabled />,
};
