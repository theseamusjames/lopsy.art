import { CharacterKeysToggle } from '../CharacterKeysToggle/CharacterKeysToggle';
import { SettingsSection } from '../SettingsSection/SettingsSection';
import form from '../SettingsSection/settings-form.module.css';

interface GeneralSettingsProps {
  /** This device's name, as other devices see it; null while it is read. */
  readonly deviceName: string | null;
}

/** Settings > General: this device's name and the keyboard. */
export function GeneralSettings({ deviceName }: GeneralSettingsProps) {
  return (
    <>
      <SettingsSection title="This device">
        <dl className={form.facts}>
          <dt>Name</dt>
          <dd>{deviceName ?? '…'}</dd>
        </dl>
      </SettingsSection>
      <SettingsSection title="Keyboard">
        <CharacterKeysToggle />
      </SettingsSection>
    </>
  );
}
