import type { StorageKind } from '@lopsy/photos-core/storage/types';
import { useSession } from '../../app/hooks';
import { DriveProviderSettings } from '../DriveProviderSettings/DriveProviderSettings';
import { SettingsSection } from '../SettingsSection/SettingsSection';
import form from '../SettingsSection/settings-form.module.css';

/** Where a library can live, as Settings names it. Google Drive is the one cloud provider so far. */
const WHERE: Record<StorageKind, { readonly provider: string | null; readonly where: string }> = {
  'google-drive': {
    provider: 'Google Drive',
    where: 'Your originals, edits and the library itself are kept in your Google Drive.',
  },
  'local-folder': { provider: null, where: 'This library is in a folder on this computer.' },
  browser: { provider: null, where: 'This library is stored in this browser.' },
  memory: { provider: null, where: 'This library is kept in memory, for this visit only.' },
};

/**
 * Settings > Cloud provider: where the library is kept, and that provider's
 * own settings (for Google Drive, how photos are added from it).
 */
export function CloudProviderSettings() {
  const session = useSession();
  const kind = session.adapter.kind;
  const { provider, where } = WHERE[kind];

  return (
    <>
      <SettingsSection title="Provider">
        {provider !== null && (
          <dl className={form.facts}>
            <dt>Library in</dt>
            <dd>{provider}</dd>
          </dl>
        )}
        <p className={form.muted}>{where}</p>
        <p className={form.muted}>
          {provider === null
            ? 'Libraries on this computer don’t use a cloud provider.'
            : 'Google Drive is the only provider for now; more are planned.'}
        </p>
      </SettingsSection>
      {kind === 'google-drive' && <DriveProviderSettings />}
    </>
  );
}
