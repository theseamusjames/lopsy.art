import { Palette, Layers, History, Info, Spline } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useUIStore } from '../../app/ui-store';
import styles from './PanelToolbar.module.css';

const ICON_SIZE = 16;

interface PanelDef {
  id: string;
  icon: React.ReactNode;
  label: string;
}

const panels: PanelDef[] = [
  { id: 'info', icon: <Info size={ICON_SIZE} />, label: 'Info' },
  { id: 'color', icon: <Palette size={ICON_SIZE} />, label: 'Color' },
  { id: 'layers', icon: <Layers size={ICON_SIZE} />, label: 'Layers' },
  { id: 'history', icon: <History size={ICON_SIZE} />, label: 'History' },
  { id: 'paths', icon: <Spline size={ICON_SIZE} />, label: 'Paths' },
];

export function PanelToolbar() {
  const visiblePanels = useUIStore((s) => s.visiblePanels);
  const togglePanel = useUIStore((s) => s.togglePanel);

  return (
    <div className={styles.toolbar}>
      {panels.map((panel) => (
        <IconButton
          key={panel.id}
          icon={panel.icon}
          label={panel.label}
          isActive={visiblePanels.has(panel.id)}
          onClick={() => togglePanel(panel.id)}
        />
      ))}
    </div>
  );
}
