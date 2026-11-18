import { useEffect, useRef } from 'react';
import { useLibraryView, useOrderedIds } from '../../app/hooks';
import { useUi } from '../../app/store';
import { copyEdits, copySource, createNamedVersion, runCommand, suggestedVersionName } from '../../app/commands';
import { NewVersionDialog } from '../NewVersionDialog/NewVersionDialog';
import { COPY_GROUPS, DEFAULT_COPY_GROUP_IDS } from '../../library/recipe-copy';
import { CopyEditsDialog } from '../CopyEditsDialog/CopyEditsDialog';
import { isTypingTarget, matchShortcut, type ShortcutContext } from '../../shortcuts/registry';
import { pruneSelection } from '../../library/selection';
import { CompareView } from '../CompareView/CompareView';
import { DeleteDialog } from '../DeleteDialog/DeleteDialog';
import { DropZone } from '../DropZone/DropZone';
import { EmptyState } from '../EmptyState/EmptyState';
import { ExportDialog } from '../ExportDialog/ExportDialog';
import { GridToolbar } from '../GridToolbar/GridToolbar';
import { FilterBar } from '../FilterBar/FilterBar';
import { Header } from '../Header/Header';
import { ImportSheet } from '../ImportSheet/ImportSheet';
import { ImportStrip } from '../ImportStrip/ImportStrip';
import { InfoPanel } from '../InfoPanel/InfoPanel';
import { PhotoGrid } from '../PhotoGrid/PhotoGrid';
import { Sidebar } from '../Sidebar/Sidebar';
import { SettingsDialog } from '../SettingsDialog/SettingsDialog';
import { SingleView } from '../SingleView/SingleView';
import styles from './LibraryScreen.module.css';

/** The library: header, sidebar, the grid or a viewer, the details panel, and the dialogs. */
export function LibraryScreen() {
  const view = useLibraryView();
  const orderedIds = useOrderedIds();
  const mode = useUi((s) => s.mode);
  const infoOpen = useUi((s) => s.infoOpen);
  const dialog = useUi((s) => s.dialog);
  const collection = useUi((s) => s.collection);
  const text = useUi((s) => s.text);
  const ordered = useRef(orderedIds);
  ordered.current = orderedIds;

  // Drop selected ids that are no longer shown; leave a viewer with nothing to show.
  useEffect(() => {
    const ui = useUi.getState();
    const pruned = pruneSelection(ui.selection, new Set(orderedIds));
    if (pruned !== ui.selection) ui.setSelection(pruned);
    if (ui.mode !== 'grid' && pruned.focus === null) ui.setMode('grid');
    if (ui.mode === 'compare' && pruned.ids.size < 2) ui.setMode('grid');
  }, [orderedIds]);

  // One key handler for the whole library; the registry says what each key does here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (ui.editing !== null || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (ui.dialog !== null && ui.dialog !== 'help' && ui.dialog !== 'sync') return;
      const context: ShortcutContext = ui.mode;
      const command = matchShortcut(e, context);
      if (command === null) return;
      e.preventDefault();
      runCommand(command, ordered.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Leaving while photos are still uploading would lose them.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const job = useUi.getState().importJob;
      if (job && !job.getProgress().finished) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // Save what is waiting when the tab goes to the background; it may not come back.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      useUi
        .getState()
        .connection?.session.syncNow()
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Cull mode ends when the user leaves full screen with the browser's own controls.
  useEffect(() => {
    const onChange = () => {
      const ui = useUi.getState();
      if (document.fullscreenElement === null && ui.mode === 'cull') ui.setMode('single');
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  let libraryEmpty = true;
  for (const a of view.assets.values()) {
    if (!a.deleted) {
      libraryEmpty = false;
      break;
    }
  }

  return (
    <div className={styles.screen} data-info={infoOpen}>
      <Header />
      <Sidebar />
      <main className={styles.main}>
        {mode === 'compare' ? (
          <CompareView orderedIds={orderedIds} />
        ) : mode === 'single' ? (
          <SingleView orderedIds={orderedIds} />
        ) : (
          <>
            {!libraryEmpty && <GridToolbar orderedIds={orderedIds} />}
            {!libraryEmpty && <FilterBar />}
            {orderedIds.length === 0 ? (
              <EmptyState libraryEmpty={libraryEmpty} collection={collection} searching={text.trim() !== ''} />
            ) : (
              <PhotoGrid orderedIds={orderedIds} />
            )}
          </>
        )}
        <ImportStrip />
      </main>
      {infoOpen && <InfoPanel />}
      {mode === 'cull' && <SingleView orderedIds={orderedIds} cull />}
      {dialog === 'import' && <ImportSheet />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'delete' && <DeleteDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'new-version' && (
        <NewVersionDialog
          suggested={suggestedVersionName()}
          onCreate={createNamedVersion}
          onClose={() => useUi.getState().openDialog(null)}
        />
      )}
      {dialog === 'copy-edits' && (
        <CopyEditsDialog
          sourceName={copySource()?.name ?? 'this photo'}
          groups={COPY_GROUPS}
          initial={DEFAULT_COPY_GROUP_IDS}
          onCopy={copyEdits}
          onClose={() => useUi.getState().openDialog(null)}
        />
      )}
      <DropZone />
    </div>
  );
}
