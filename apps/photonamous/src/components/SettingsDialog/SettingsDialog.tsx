import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Cloud, Database, SlidersHorizontal, type LucideProps } from 'lucide-react';
import { getBackend } from '../../app/backend-registry';
import type { DeviceInfo } from '../../app/backend';
import { useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { useTabs } from '../../edit/tabs';
import { CloudProviderSettings } from '../CloudProviderSettings/CloudProviderSettings';
import { DataSettings } from '../DataSettings/DataSettings';
import { GeneralSettings } from '../GeneralSettings/GeneralSettings';
import { Modal } from '../Modal/Modal';
import styles from './SettingsDialog.module.css';

export type SettingsSectionId = 'general' | 'data' | 'cloud';

const SECTIONS: readonly { readonly id: SettingsSectionId; readonly label: string; readonly icon: ComponentType<LucideProps> }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'cloud', label: 'Cloud provider', icon: Cloud },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

interface SettingsDialogProps {
  /** The section it opens on. */
  readonly initialSection?: SettingsSectionId;
}

/**
 * Settings, in sections: a list of them on the left (a vertical tab list)
 * and the chosen one's settings on the right. It opens on the chosen
 * section's tab rather than on a control that clears or changes something.
 * Every section stays mounted while the dialog is open, so a check under
 * way, or its report, is still there after a look at another section.
 */
export function SettingsDialog({ initialSection = 'general' }: SettingsDialogProps) {
  const session = useSession();
  const openDialog = useUi((s) => s.openDialog);
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const { tabProps, panelProps } = useTabs(SECTION_IDS, section, setSection, 'vertical');
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  const refreshDevice = () => {
    getBackend()
      .getDeviceInfo(session)
      .then(setDevice)
      .catch(() => setDevice(null));
  };
  useEffect(refreshDevice, [session]);

  const panels: Record<SettingsSectionId, ReactNode> = {
    general: <GeneralSettings deviceName={device?.deviceName ?? null} />,
    data: <DataSettings device={device} onDeviceChange={refreshDevice} />,
    cloud: <CloudProviderSettings />,
  };

  return (
    <Modal title="Settings" width="lg" onClose={() => openDialog(null)}>
      <div className={styles.layout}>
        <div className={styles.nav} role="tablist" aria-label="Settings sections" aria-orientation="vertical">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={styles.tab} {...tabProps(id)} data-autofocus={id === initialSection ? '' : undefined}>
              <Icon size={16} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div className={styles.panel} {...panelProps}>
          {SECTIONS.map(({ id, label }) => (
            <div key={id} hidden={id !== section}>
              <h3 className={styles.panelTitle}>{label}</h3>
              {panels[id]}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
