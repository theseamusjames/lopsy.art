import { ImagePlus } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useUIStore } from '../../app/ui-store';
import { DOCK_PANELS } from '../dock/panel-registry';
import styles from './PanelToolbar.module.css';

const ICON_SIZE = 16;

export function PanelToolbar() {
  const visiblePanels = useUIStore((s) => s.visiblePanels);
  const togglePanel = useUIStore((s) => s.togglePanel);
  const showReferenceModal = useUIStore((s) => s.showReferenceModal);
  const setShowReferenceModal = useUIStore((s) => s.setShowReferenceModal);

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Panel visibility">
      {DOCK_PANELS.map((panel) => {
        const Icon = panel.icon;
        return (
          <IconButton
            key={panel.id}
            icon={<Icon size={ICON_SIZE} />}
            label={panel.title}
            isActive={visiblePanels.has(panel.id)}
            onClick={() => togglePanel(panel.id)}
          />
        );
      })}
      <IconButton
        icon={<ImagePlus size={ICON_SIZE} />}
        label="Reference"
        isActive={showReferenceModal}
        onClick={() => setShowReferenceModal(!showReferenceModal)}
      />
    </div>
  );
}
