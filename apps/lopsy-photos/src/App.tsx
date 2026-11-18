import { useCallback, useEffect, useState } from 'react';
import { getBackend } from './app/backend-registry';
import { ConnectCancelled, type ConnectOptions, type ReconnectOffer, type StorageChoice } from './app/backend';
import { useUi } from './app/store';
import { LibraryBusyError } from '@lopsy/photos-core/library/lock';
import { Toasts } from './components/Toasts/Toasts';
import { StartScreen } from './components/StartScreen/StartScreen';
import { LibraryScreen } from './components/LibraryScreen/LibraryScreen';
import { EditSlot } from './app/EditSlot/EditSlot';
import styles from './App.module.css';

/** The browser's own storage reopens by itself once per page load; after "Close" it waits for a click. */
let autoOpenTried = false;

export function App() {
  const connection = useUi((s) => s.connection);
  const connecting = useUi((s) => s.connecting);
  const connectError = useUi((s) => s.connectError);
  const editing = useUi((s) => s.editing);
  const setEditing = useUi((s) => s.setEditing);
  const [offer, setOffer] = useState<ReconnectOffer | null>(null);
  const [busyKind, setBusyKind] = useState<StorageChoice | null>(null);

  const choose = useCallback((kind: StorageChoice, options?: ConnectOptions) => {
    const ui = useUi.getState();
    ui.setConnecting(kind);
    setBusyKind(null);
    getBackend()
      .connect(kind, options)
      .then((c) => {
        useUi.getState().setConnection(c);
        // Imports a reload interrupted carry on, shown in the strip.
        getBackend()
          .resumeImports(c.session)
          .then((job) => {
            if (job) useUi.getState().setImportJob(job);
          })
          .catch((error: unknown) => console.warn('Unfinished imports could not be resumed', error));
      })
      .catch((error: unknown) => {
        if (error instanceof ConnectCancelled) return useUi.getState().setConnecting(null);
        if (error instanceof LibraryBusyError) {
          setBusyKind(kind);
          return useUi.getState().setConnecting(null);
        }
        console.warn('Could not open the library', error);
        const message = error instanceof Error ? error.message : String(error);
        useUi.getState().setConnecting(null, `The library could not be opened: ${message}`);
      });
  }, []);

  useEffect(() => {
    if (connection) return;
    let live = true;
    getBackend()
      .getReconnectOffer()
      .then((o) => {
        if (!live) return;
        setOffer(o);
        if (o?.automatic && !autoOpenTried) {
          autoOpenTried = true;
          choose(o.kind, { reconnect: true });
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connection, choose]);

  if (!connection) {
    return (
      <>
      <StartScreen
        choices={getBackend().listStorageOptions()}
        busyKind={busyKind}
        onTakeOver={(kind) => choose(kind, { reconnect: true, takeOver: true })}
        offer={offer}
        connecting={connecting}
        error={connectError}
        onChoose={(kind) => choose(kind)}
        onReconnect={(o) => choose(o.kind, { reconnect: true })}
      />
      <Toasts />
      </>
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
      <Toasts />
    </div>
  );
}
