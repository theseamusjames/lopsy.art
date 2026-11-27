import { useState } from 'react';
import { getBackend } from '../../app/backend-registry';
import { useSession } from '../../app/hooks';
import { loadDriveAddMode, loadDrivePicker, saveDriveAddMode, saveDrivePicker, type DriveAddMode } from '../../app/device-settings';
import { blocksCrossSiteCookies, chooseDrivePicker, type DrivePicker } from '../../import/drive-picker';
import { SettingsSection } from '../SettingsSection/SettingsSection';
import form from '../SettingsSection/settings-form.module.css';

/** Settings > Cloud provider for a Google Drive library: whether added photos are moved, and where Google's file picker opens. */
export function DriveProviderSettings() {
  const session = useSession();
  const [driveMode, setDriveMode] = useState<DriveAddMode>(loadDriveAddMode);
  /** Offered only where there is a choice: a build that can show Google's Picker in the page. */
  const canPickInPage = getBackend().canPickDriveInPage(session);
  const [drivePicker, setDrivePicker] = useState<DrivePicker>(() =>
    chooseDrivePicker({ pageAvailable: canPickInPage, remembered: loadDrivePicker(), blocksCrossSiteCookies: blocksCrossSiteCookies() }),
  );
  const chooseMode = (mode: DriveAddMode) => {
    setDriveMode(mode);
    saveDriveAddMode(mode);
  };
  const choosePicker = (picker: DrivePicker) => {
    setDrivePicker(picker);
    saveDrivePicker(picker);
  };

  return (
    <>
      <SettingsSection title="Adding from Google Drive">
        {(headingId) => (
          <div className={form.group} role="radiogroup" aria-labelledby={headingId}>
            <label className={form.option}>
              <input type="radio" name="drive-add" checked={driveMode === 'move'} onChange={() => chooseMode('move')} />
              Move them into the library’s Originals folder
            </label>
            <label className={form.option}>
              <input type="radio" name="drive-add" checked={driveMode === 'leave'} onChange={() => chooseMode('leave')} />
              Leave them where they are in Drive
            </label>
          </div>
        )}
      </SettingsSection>
      {canPickInPage && (
        <SettingsSection title="Google’s file picker opens">
          {(headingId) => (
            <>
              <div className={form.group} role="radiogroup" aria-labelledby={headingId}>
                <label className={form.option}>
                  <input type="radio" name="drive-picker" checked={drivePicker === 'page'} onChange={() => choosePicker('page')} />
                  Here, in the page
                </label>
                <label className={form.option}>
                  <input type="radio" name="drive-picker" checked={drivePicker === 'window'} onChange={() => choosePicker('window')} />
                  In a Google window
                </label>
              </div>
              <p className={form.muted}>
                In the page is quicker. If Google asks you to sign in there, your browser is blocking it: use a Google window, where
                you choose your account each time.
              </p>
            </>
          )}
        </SettingsSection>
      )}
    </>
  );
}
