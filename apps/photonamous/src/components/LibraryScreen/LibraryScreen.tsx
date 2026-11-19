import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useLibraryView, useOrderedIds } from '../../app/hooks';
import { useUi } from '../../app/store';
import { copyEdits, copySource, createNamedVersion, runCommand, suggestedVersionName } from '../../app/commands';
import { NewVersionDialog } from '../NewVersionDialog/NewVersionDialog';
import { COPY_GROUPS, DEFAULT_COPY_GROUP_IDS } from '../../library/recipe-copy';
import { CopyEditsDialog } from '../CopyEditsDialog/CopyEditsDialog';
import { isTypingTarget, matchShortcut, type ShortcutContext } from '../../shortcuts/registry';
import { pruneSelection } from '../../library/selection';
import { parseItem } from '../../library/items';
import { CompareView } from '../CompareView/CompareView';
import { DeleteDialog } from '../DeleteDialog/DeleteDialog';
import { DropZone } from '../DropZone/DropZone';
import { EmptyState } from '../EmptyState/EmptyState';
import { ExportDialog } from '../ExportDialog/ExportDialog';
import { GridToolbar } from '../GridToolbar/GridToolbar';
import { useCollectionTitle } from '../GridToolbar/collection-title';
import { FilterBar } from '../FilterBar/FilterBar';
import { Header } from '../Header/Header';
import { ImportSheet } from '../ImportSheet/ImportSheet';
import { ImportStrip } from '../ImportStrip/ImportStrip';
import { InfoPanel } from '../InfoPanel/InfoPanel';
import { PhotoGrid } from '../PhotoGrid/PhotoGrid';
import { Sidebar } from '../Sidebar/Sidebar';
import { SettingsDialog } from '../SettingsDialog/SettingsDialog';
import { SingleView } from '../SingleView/SingleView';
import { isControlKey } from './control-keys';
import styles from './LibraryScreen.module.css';

/** The library: header, sidebar, the grid or a viewer, the details panel, and the dialogs. */
export function LibraryScreen() {
  const view = useLibraryView();
  // False for the one render a closing library may still get (see useSession).
  const connected = useUi((s) => s.connection !== null);
  const orderedIds = useOrderedIds();
  const mode = useUi((s) => s.mode);
  const infoOpen = useUi((s) => s.infoOpen);
  const dialog = useUi((s) => s.dialog);
  const collection = useUi((s) => s.collection);
  const text = useUi((s) => s.text);
  const editing = useUi((s) => s.editing !== null);
  const focus = useUi((s) => s.selection.focus);
  const title = useCollectionTitle();
  const ordered = useRef(orderedIds);
  ordered.current = orderedIds;
  const main = useRef<HTMLElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');

  /*
   * While a dialog, the Edit view or Cull covers the library, the rest of it
   * is out of reach (aria-modal made true). Inert comes a frame after the
   * layer on top has taken focus and noted where focus was, to give it back
   * there (a focused element turning inert would lose focus first), and goes
   * before that layer gives focus back.
   */
  const covered = editing || mode === 'cull' || (dialog !== null && dialog !== 'help' && dialog !== 'sync');
  useLayoutEffect(() => {
    if (!covered && layout.current) layout.current.inert = false;
  }, [covered]);
  useEffect(() => {
    if (!covered) return;
    const frame = requestAnimationFrame(() => {
      if (layout.current) layout.current.inert = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [covered]);
  const shown = focus === null ? undefined : view.assets.get(parseItem(focus).assetId);

  // The page title names the view; the Edit view names itself.
  useEffect(() => {
    if (editing) return;
    const name = shown?.fileName ?? 'No photo';
    const words = mode === 'compare' ? 'Compare' : mode === 'single' ? name : mode === 'cull' ? `${name} – Cull` : title;
    document.title = `${words} – Photonamous`;
  }, [editing, mode, title, shown?.fileName]);

  // Leaving full screen is said, not only seen.
  const lastMode = useRef(mode);
  useEffect(() => {
    const was = lastMode.current;
    lastMode.current = mode;
    if (was === 'cull' && mode !== 'cull') setAnnouncement('Left full screen');
    else if (mode === 'cull') setAnnouncement('');
  }, [mode]);

  /** Skip to photos: the grid's tab stop, else the viewer, else the grid's heading, else the first control there. */
  const skipToPhotos = (e: MouseEvent<HTMLAnchorElement>) => {
    const el = main.current;
    if (!el) return;
    e.preventDefault();
    const target =
      el.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]') ??
      el.querySelector<HTMLElement>('[role="region"][tabindex="-1"]') ??
      el.querySelector<HTMLElement>('h1[tabindex="-1"]') ??
      el.querySelector<HTMLElement>('button:not(:disabled), a[href], input, select');
    if (target) return target.focus();
    el.tabIndex = -1;
    el.focus();
  };

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
      if (ui.editing !== null || e.defaultPrevented || isTypingTarget(e.target) || isControlKey(e, e.target)) return;
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
    <div className={styles.screen}>
      <div ref={layout} className={styles.layout} data-info={infoOpen}>
        <a className={styles.skip} href="#library-main" onClick={skipToPhotos}>
          Skip to photos
        </a>
        <Header />
        <Sidebar />
        <main id="library-main" ref={main} className={styles.main}>
          {libraryEmpty && <h1 className={styles.visuallyHidden}>{title}</h1>}
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
      </div>
      <p className={styles.visuallyHidden} role="status">
        {announcement}
      </p>
      {mode === 'cull' && <SingleView orderedIds={orderedIds} cull />}
      {dialog === 'import' && <ImportSheet />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'delete' && <DeleteDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'new-version' && (
        <NewVersionDialog
          suggested={connected ? suggestedVersionName() : 'Version 2'}
          onCreate={createNamedVersion}
          onClose={() => useUi.getState().openDialog(null)}
        />
      )}
      {dialog === 'copy-edits' && (
        <CopyEditsDialog
          sourceName={(connected ? copySource()?.name : undefined) ?? 'this photo'}
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
