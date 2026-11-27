import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsSection } from './SettingsSection';
import form from './settings-form.module.css';

const meta: Meta<typeof SettingsSection> = {
  component: SettingsSection,
};

export default meta;
type Story = StoryObj<typeof SettingsSection>;

export const Default: Story = {
  args: {
    title: 'This device',
    children: (
      <dl className={form.facts}>
        <dt>Name</dt>
        <dd>Studio laptop</dd>
      </dl>
    ),
  },
};

export const Choices: Story = {
  args: {
    title: 'Adding from Google Drive',
    children: (headingId: string) => (
      <div className={form.group} role="radiogroup" aria-labelledby={headingId}>
        <label className={form.option}>
          <input type="radio" name="story" defaultChecked /> Move them into the library’s Originals folder
        </label>
        <label className={form.option}>
          <input type="radio" name="story" /> Leave them where they are in Drive
        </label>
      </div>
    ),
  },
};
