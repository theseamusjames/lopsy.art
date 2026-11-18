import { useCallback } from 'react';
import { getBackend } from './app/backend-registry';
import type { StorageChoice } from './app/backend';
import { useUi } from './app/store';
import { StartScreen } from './components/StartScreen/StartScreen';
import { LibraryScreen } from './components/LibraryScreen/LibraryScreen';
import { EditSlot } from './app/EditSlot/EditSlot';
import styles from './App.module.css';

export function App() {
  const connection = useUi((s) => s.connection);
  const connecting = useUi((s) => s.connecting);
  const connectError = useUi((s) => s.connectError);
  const editing = useUi((s) => s.editing);
  const setEditing = useUi((s) => s.setEditing);

  const choose = useCallback((kind: StorageChoice) => {
    const ui = useUi.getState();
    ui.setConnecting(kind);
    getBackend()
      .connect(kind)
      .then((c) => useUi.getState().setConnection(c))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        useUi.getState().setConnecting(null, `The library could not be opened: ${message}`);
      });
  }, []);

  if (!connection) {
    return (
      <StartScreen
        choices={getBackend().listStorageOptions()}
        connecting={connecting}
        error={connectError}
        onChoose={choose}
      />
    );
  }

  return (
    <div className={styles.app}>
      <LibraryScreen />
      {editing && (
        <div className={styles.edit}>
          <EditSlot assetId={editing.assetId} versionId={editing.versionId} onClose={() => setEditing(null)} />
        </div>
      )}
    </div>
  );
}
