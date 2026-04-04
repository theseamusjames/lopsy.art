import { SquareDashed, Trash2, PenLine } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { pathToSelection } from './path-to-selection';
import styles from './PathsPanel.module.css';

interface PathsPanelProps {
  collapsed?: boolean;
}

export function PathsPanel({ collapsed = false }: PathsPanelProps) {
  const paths = useEditorStore((s) => s.paths);
  const selectedPathId = useEditorStore((s) => s.selectedPathId);
  const selectPath = useEditorStore((s) => s.selectPath);
  const removePath = useEditorStore((s) => s.removePath);
  const setStrokeModalPathId = useUIStore((s) => s.setStrokeModalPathId);

  const handleSelect = (id: string) => {
    selectPath(selectedPathId === id ? null : id);
  };

  const handleStroke = () => {
    if (selectedPathId) {
      setStrokeModalPathId(selectedPathId);
    }
  };

  const handleMarquee = () => {
    if (!selectedPathId) return;
    const path = paths.find((p) => p.id === selectedPathId);
    if (path) {
      pathToSelection(path);
    }
  };

  const handleDelete = () => {
    if (selectedPathId) {
      removePath(selectedPathId);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={collapsed ? styles.listCollapsed : styles.list}>
        {paths.length === 0 && (
          <div className={styles.empty}>No paths</div>
        )}
        {paths.map((path) => (
          <div
            key={path.id}
            className={[
              styles.item,
              path.id === selectedPathId ? styles.active : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => handleSelect(path.id)}
            data-testid={`path-item-${path.id}`}
          >
            <span className={styles.name}>{path.name}</span>
          </div>
        ))}
      </div>
      <div className={styles.toolbar}>
        <IconButton
          icon={<PenLine size={16} />}
          label="Stroke Path"
          onClick={handleStroke}
          disabled={!selectedPathId}
        />
        <IconButton
          icon={<SquareDashed size={16} />}
          label="Path to Selection"
          onClick={handleMarquee}
          disabled={!selectedPathId}
        />
        <IconButton
          icon={<Trash2 size={16} />}
          label="Delete Path"
          onClick={handleDelete}
          disabled={!selectedPathId}
        />
      </div>
    </div>
  );
}
