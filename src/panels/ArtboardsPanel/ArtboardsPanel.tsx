import { useState, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useEditorStore } from '../../app/editor-store';
import { PanelContainer } from '../PanelContainer/PanelContainer';
import { usePanelCollapse } from '../usePanelCollapse';
import styles from './ArtboardsPanel.module.css';

export function ArtboardsPanel() {
  const [collapsed, setCollapsed] = usePanelCollapse('artboards');
  const artboards = useEditorStore((s) => s.artboards);
  const addArtboard = useEditorStore((s) => s.addArtboard);
  const removeArtboard = useEditorStore((s) => s.removeArtboard);
  const renameArtboard = useEditorStore((s) => s.renameArtboard);
  const doc = useEditorStore((s) => s.document);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const viewport = useEditorStore((s) => s.viewport);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleAddArtboard = useCallback(() => {
    addArtboard({
      name: `Artboard ${artboards.length + 1}`,
      x: 0,
      y: 0,
      width: doc.width,
      height: doc.height,
    });
  }, [addArtboard, artboards.length, doc.width, doc.height]);

  const handleZoomToArtboard = useCallback(
    (id: string) => {
      const ab = artboards.find((a) => a.id === id);
      if (!ab) return;

      // Fit the artboard in the viewport with some padding
      const padding = 40;
      const availW = viewport.width - padding * 2;
      const availH = viewport.height - padding * 2;
      const scaleX = availW / ab.width;
      const scaleY = availH / ab.height;
      const zoom = Math.min(scaleX, scaleY, 4);

      // Center the artboard: pan such that artboard center is at viewport center
      const abCenterX = ab.x + ab.width / 2;
      const abCenterY = ab.y + ab.height / 2;
      const docCenterX = doc.width / 2;
      const docCenterY = doc.height / 2;
      const panX = (docCenterX - abCenterX) * zoom;
      const panY = (docCenterY - abCenterY) * zoom;

      setZoom(zoom);
      setPan(panX, panY);
    },
    [artboards, viewport.width, viewport.height, doc.width, doc.height, setZoom, setPan],
  );

  const handleStartRename = useCallback((id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  }, []);

  const handleCommitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      renameArtboard(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, renameArtboard]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCommitRename();
      if (e.key === 'Escape') {
        setRenamingId(null);
        setRenameValue('');
      }
    },
    [handleCommitRename],
  );

  return (
    <PanelContainer
      title="Artboards"
      collapsed={collapsed}
      onToggle={() => setCollapsed((c) => !c)}
    >
      <div className={styles.toolbar}>
        <IconButton
          icon={<Plus size={14} />}
          label="New Artboard"
          onClick={handleAddArtboard}
        />
      </div>
      {artboards.length === 0 ? (
        <div className={styles.empty}>No artboards</div>
      ) : (
        <div className={collapsed ? styles.listCollapsed : styles.list}>
          {artboards.map((ab) => (
            <div
              key={ab.id}
              className={styles.row}
              data-artboard-id={ab.id}
            >
              <button
                className={styles.rowMain}
                onClick={() => handleZoomToArtboard(ab.id)}
                type="button"
                title={`${ab.name} — ${ab.width}×${ab.height}`}
              >
                {renamingId === ab.id ? (
                  <input
                    className={styles.renameInput}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={handleCommitRename}
                    onKeyDown={handleRenameKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span
                    className={styles.name}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleStartRename(ab.id, ab.name);
                    }}
                  >
                    {ab.name}
                  </span>
                )}
                <span className={styles.dimensions}>
                  {ab.width}×{ab.height}
                </span>
              </button>
              <IconButton
                icon={<Trash2 size={12} />}
                label={`Remove artboard ${ab.name}`}
                onClick={() => removeArtboard(ab.id)}
              />
            </div>
          ))}
        </div>
      )}
    </PanelContainer>
  );
}
