import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { PanelContainer } from '../PanelContainer/PanelContainer';
import { usePanelCollapse } from '../usePanelCollapse';
import styles from './InfoPanel.module.css';

export function InfoPanel() {
  const [collapsed, setCollapsed] = usePanelCollapse('info');
  const selection = useEditorStore((s) => s.selection);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const layers = useEditorStore((s) => s.document.layers);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const cursorPosition = useUIStore((s) => s.cursorPosition);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const layerWidth = activeLayer && 'width' in activeLayer ? activeLayer.width : null;
  const layerHeight = activeLayer && 'height' in activeLayer ? activeLayer.height : null;

  const posX = selection.active && selection.bounds ? selection.bounds.x : cursorPosition.x;
  const posY = selection.active && selection.bounds ? selection.bounds.y : cursorPosition.y;

  return (
    <PanelContainer title="Info" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)}>
      {collapsed ? (
        <div className={styles.grid}>
          <span className={styles.section}>Layer</span>
          <span className={styles.label}>X</span>
          <span className={styles.value}>{posX}</span>
          {layerWidth != null && (
            <>
              <span className={styles.label}>W</span>
              <span className={styles.value}>{layerWidth}</span>
            </>
          )}
          <span className={styles.label}>Y</span>
          <span className={styles.value}>{posY}</span>
          {layerHeight != null && (
            <>
              <span className={styles.label}>H</span>
              <span className={styles.value}>{layerHeight}</span>
            </>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          <span className={styles.section}>Cursor</span>
          <span className={styles.label}>X</span>
          <span className={styles.value}>{posX}</span>
          <span className={styles.label}>Y</span>
          <span className={styles.value}>{posY}</span>

          <span className={styles.section}>Canvas</span>
          <span className={styles.label}>W</span>
          <span className={styles.value}>{docWidth}</span>
          <span className={styles.label}>H</span>
          <span className={styles.value}>{docHeight}</span>

          {activeLayer && (
            <>
              <span className={styles.section}>Layer</span>
              <span className={styles.label}>X</span>
              <span className={styles.value}>{activeLayer.x}</span>
              {layerWidth != null && (
                <>
                  <span className={styles.label}>W</span>
                  <span className={styles.value}>{layerWidth}</span>
                </>
              )}
              <span className={styles.label}>Y</span>
              <span className={styles.value}>{activeLayer.y}</span>
              {layerHeight != null && (
                <>
                  <span className={styles.label}>H</span>
                  <span className={styles.value}>{layerHeight}</span>
                </>
              )}
            </>
          )}

          {selection.active && selection.bounds && (
            <>
              <span className={styles.section}>Selection</span>
              <span className={styles.label}>X</span>
              <span className={styles.value}>{selection.bounds.x}</span>
              <span className={styles.label}>W</span>
              <span className={styles.value}>{selection.bounds.width}</span>
              <span className={styles.label}>Y</span>
              <span className={styles.value}>{selection.bounds.y}</span>
              <span className={styles.label}>H</span>
              <span className={styles.value}>{selection.bounds.height}</span>
            </>
          )}
        </div>
      )}
    </PanelContainer>
  );
}
