import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { ImageX } from '../../icons/ImageX';
import type { Asset, Rating } from '@lopsy/photos-core/library/types';
import { useLibraryView, useOrderedIds, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { currentItems, currentTargets, setLabel, setRating, toggleSetAside } from '../../app/commands';
import { formatBytes } from '../../import/import-summary';
import { formatCamera, formatCaptureTime, formatDimensions, formatExposure } from '../../library/format';
import { albumHasItem, parseItem, setAlbumItem } from '../../library/items';
import { Button } from '../Button/Button';
import { LabelPicker } from '../LabelPicker/LabelPicker';
import { Stars } from '../Stars/Stars';
import styles from './InfoPanel.module.css';

/** The same value across all, or undefined when they differ. */
function common<T>(assets: readonly Asset[], pick: (a: Asset) => T): T | undefined {
  const first = assets[0];
  if (!first) return undefined;
  const v = pick(first);
  return assets.every((a) => pick(a) === v) ? v : undefined;
}

/** Details of the selected photo(s): facts from the file, and the marks and words the user adds. */
export function InfoPanel() {
  const view = useLibraryView();
  const session = useSession();
  const orderedIds = useOrderedIds();
  const selection = useUi((s) => s.selection);
  const mode = useUi((s) => s.mode);
  const [keyword, setKeyword] = useState('');

  const ids = useMemo(() => currentTargets(), [selection, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => currentItems(), [selection, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const assets = useMemo(
    () => ids.map((id) => view.assets.get(id)).filter((a): a is Asset => a !== undefined && !a.deleted),
    [ids, view],
  );
  const albums = useMemo(() => [...view.albums.values()].filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name)), [view]);

  if (assets.length === 0) {
    return (
      <aside className={styles.panel} aria-label="Details">
        <p className={styles.empty}>Select a photo to see its details here.</p>
      </aside>
    );
  }

  const one = assets.length === 1 ? assets[0] : undefined;
  const rating = common(assets, (a) => a.rating);
  const label = common(assets, (a) => a.label);
  const allAside = assets.every((a) => a.setAside);
  const keywordCounts = new Map<string, number>();
  for (const a of assets) for (const k of a.keywords) keywordCounts.set(k, (keywordCounts.get(k) ?? 0) + 1);
  const targetIds = assets.map((a) => a.id);

  const addKeyword = () => {
    const k = keyword.trim();
    if (k !== '') session.setKeyword(targetIds, k, true);
    setKeyword('');
  };

  const facts: Array<[string, string | null]> = one
    ? [
        ['Taken', formatCaptureTime(one.capturedAt)],
        ['Camera', formatCamera(one.camera)],
        ['Lens', one.lens],
        ['Exposure', formatExposure(one.exposure)],
        ['Size', formatDimensions(one.width, one.height)],
        ['File', `${one.format.toUpperCase()}, ${formatBytes(one.byteSize)}`],
        ['Added', formatCaptureTime(one.importedAt.slice(0, 16))],
      ]
    : [];

  return (
    <aside className={styles.panel} aria-label="Details">
      <header className={styles.head}>
        <h2 className={styles.title}>{one ? one.fileName : `${assets.length.toLocaleString()} photos`}</h2>
        {!one && <p className={styles.muted}>Changes here apply to all of them.</p>}
      </header>

      {/* The Single view has the marks in its own bars, around the photo. */}
      {mode !== 'single' && (
        <section className={styles.section}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Rating</span>
            <Stars
              rating={rating ?? 0}
              mixed={rating === undefined}
              size={16}
              onChange={(r: Rating) => setRating(r, orderedIds, targetIds)}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Label</span>
            <LabelPicker value={label} onChange={(l) => setLabel(l, orderedIds, targetIds)} />
          </div>
          <Button size="sm" variant={allAside ? 'primary' : 'secondary'} onClick={() => toggleSetAside(orderedIds, targetIds)}>
            <ImageX size={13} />
            {allAside ? 'Bring back' : 'Drop'}
          </Button>
        </section>
      )}

      {one && (
        <section className={styles.section}>
          <label className={styles.stack}>
            <span className={styles.fieldLabel}>Title</span>
            <input
              key={`${one.id}:title:${one.title}`}
              className={styles.input}
              defaultValue={one.title}
              placeholder="Add a title"
              onBlur={(e) => {
                if (e.target.value !== one.title) session.setMarks([one.id], { title: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
          <label className={styles.stack}>
            <span className={styles.fieldLabel}>Caption</span>
            <textarea
              key={`${one.id}:caption:${one.caption}`}
              className={styles.textarea}
              defaultValue={one.caption}
              placeholder="Add a caption"
              rows={3}
              onBlur={(e) => {
                if (e.target.value !== one.caption) session.setMarks([one.id], { caption: e.target.value });
              }}
            />
          </label>
        </section>
      )}

      <section className={styles.section}>
        <span className={styles.fieldLabel}>Keywords</span>
        <div className={styles.chips}>
          {[...keywordCounts.entries()].map(([k, n]) => (
            <span key={k} className={styles.chip} data-partial={n < assets.length}>
              {k}
              {n < assets.length && <span className={styles.chipCount}>{n}</span>}
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove ${k}`}
                onClick={() => session.setKeyword(targetIds, k, false)}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <input
          className={styles.input}
          placeholder="Add a keyword and press Enter"
          aria-label="Add a keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addKeyword();
          }}
        />
      </section>

      {albums.length > 0 && (
        <section className={styles.section}>
          <span className={styles.fieldLabel}>
            {items.length > 0 && items.every((id) => parseItem(id).versionId !== null)
              ? items.length === 1
                ? 'This version in albums'
                : 'These versions in albums'
              : 'In albums'}
          </span>
          {albums.map((album) => {
            const inCount = items.filter((id) => albumHasItem(album, id)).length;
            return (
              <label key={album.id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={items.length > 0 && inCount === items.length}
                  ref={(el) => {
                    if (el) el.indeterminate = inCount > 0 && inCount < items.length;
                  }}
                  onChange={(e) => {
                    for (const id of items) setAlbumItem(session, album.id, id, e.target.checked);
                  }}
                />
                {album.name}
              </label>
            );
          })}
        </section>
      )}

      {one && (
        <section className={styles.section}>
          <dl className={styles.facts}>
            {facts
              .filter((f): f is [string, string] => f[1] !== null)
              .map(([k, v]) => (
                <div key={k} className={styles.fact}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}
    </aside>
  );
}
