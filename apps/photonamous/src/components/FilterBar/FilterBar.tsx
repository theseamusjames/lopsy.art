import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BookmarkPlus, ChevronDown, X } from 'lucide-react';
import type { LabelChoice, SearchRule } from '@lopsy/photos-core/search/rules';
import { writeSavedSearches } from '@lopsy/photos-core/search/rules';
import { useFindResult, useSavedSearches, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { hasFacets, NO_FACETS, newSavedSearchId, ruleForSaving, toggleValue, type FacetFilter } from '../../library/finding';
import { Button } from '../Button/Button';
import { Popover } from '../Popover/Popover';
import styles from './FilterBar.module.css';

type FacetName = 'camera' | 'lens' | 'rating' | 'label' | 'format' | 'edited';

const LABEL_WORDS: Readonly<Record<LabelChoice, string>> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  none: 'No label',
};

const FORMAT_WORDS: Readonly<Record<string, string>> = {
  raf: 'RAW (Fujifilm)',
  dng: 'RAW (DNG)',
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  lopsy: 'Lopsy document',
};

function summary(f: FacetFilter, name: FacetName): string | null {
  switch (name) {
    case 'camera':
      return f.cameras.length === 0 ? null : f.cameras.join(', ');
    case 'lens':
      return f.lenses.length === 0 ? null : f.lenses.length === 1 ? (f.lenses[0] ?? null) : `${f.lenses.length} lenses`;
    case 'rating':
      return f.minRating === null ? null : `${f.minRating}★ or more`;
    case 'label':
      return f.labels.length === 0 ? null : f.labels.map((l) => LABEL_WORDS[l]).join(', ');
    case 'format':
      return f.formats.length === 0 ? null : f.formats.map((x) => FORMAT_WORDS[x] ?? x).join(', ');
    case 'edited':
      return f.edited === null ? null : f.edited ? 'Edited' : 'Not edited';
  }
}

const TITLES: Readonly<Record<FacetName, string>> = {
  camera: 'Camera',
  lens: 'Lens',
  rating: 'Rating',
  label: 'Label',
  format: 'File type',
  edited: 'Edits',
};

/** Narrows the grid by camera, lens, rating, label, file type and edits, with counts; saves the result as a search. */
export function FilterBar() {
  const session = useSession();
  const result = useFindResult();
  const saved = useSavedSearches();
  const facets = useUi((s) => s.facets);
  const setFacets = useUi((s) => s.setFacets);
  const collection = useUi((s) => s.collection);
  const setCollection = useUi((s) => s.setCollection);
  const [open, setOpen] = useState<FacetName | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const anchors = useRef(new Map<FacetName, HTMLDivElement>());
  const bar = useRef<HTMLDivElement>(null);
  const saveButton = () => bar.current?.querySelector<HTMLElement>('[data-save-search]') ?? null;
  /** The control focus goes back to when what had it (a popover's checkbox, the name field) goes away. */
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    const active = document.activeElement;
    for (const anchor of anchors.current.values()) {
      if (active !== null && anchor.contains(active)) returnTo.current = anchor.querySelector('button');
    }
    setOpen(null);
  }, []);
  useEffect(() => {
    const target = returnTo.current;
    returnTo.current = null;
    const active = document.activeElement;
    if (target && (active === null || active === document.body)) target.focus();
  }, [open, naming]);
  const counts = result.facets;

  const savedRule: SearchRule | null =
    collection.kind === 'saved' ? (saved.find((s) => s.id === collection.searchId)?.rule ?? null) : null;
  const rule = ruleForSaving(collection, facets, savedRule);
  const canSave = rule !== null && (hasFacets(facets) || collection.kind === 'date');

  const save = () => {
    const trimmed = name.trim();
    if (trimmed === '' || rule === null) return;
    const id = newSavedSearchId();
    writeSavedSearches(session, [...saved, { id, name: trimmed, rule }]);
    returnTo.current = saveButton();
    setNaming(false);
    setName('');
    setCollection({ kind: 'saved', searchId: id });
  };

  const option = (key: string, label: ReactNode, count: number, checked: boolean, onToggle: () => void) => (
    <label key={key} className={styles.option}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className={styles.optionLabel}>{label}</span>
      <span className={styles.count}>{count.toLocaleString()}</span>
    </label>
  );

  const panel = (name: FacetName): ReactNode => {
    switch (name) {
      case 'camera':
        return counts.camera.length === 0
          ? <p className={styles.none}>No camera is known for these photos.</p>
          : counts.camera.map((c) =>
              option(c.value, c.value, c.count, facets.cameras.includes(c.value), () =>
                setFacets({ ...facets, cameras: toggleValue(facets.cameras, c.value) }),
              ),
            );
      case 'lens':
        return counts.lens.length === 0
          ? <p className={styles.none}>No lens is known for these photos.</p>
          : counts.lens.map((c) =>
              option(c.value, c.value, c.count, facets.lenses.includes(c.value), () =>
                setFacets({ ...facets, lenses: toggleValue(facets.lenses, c.value) }),
              ),
            );
      case 'rating': {
        const atLeast = (n: number) => counts.rating.filter((r) => r.value >= n).reduce((sum, r) => sum + r.count, 0);
        return [1, 2, 3, 4, 5].map((n) =>
          option(
            String(n),
            <>
              <span aria-hidden="true">{'★'.repeat(n)}</span>
              <span className={styles.visuallyHidden}>
                {n} star{n === 1 ? '' : 's'}
              </span>{' '}
              or more
            </>,
            atLeast(n),
            facets.minRating === n,
            () => setFacets({ ...facets, minRating: facets.minRating === n ? null : n }),
          ),
        );
      }
      case 'label':
        return counts.label.map((c) =>
          option(c.value, LABEL_WORDS[c.value], c.count, facets.labels.includes(c.value), () =>
            setFacets({ ...facets, labels: toggleValue(facets.labels, c.value) }),
          ),
        );
      case 'format':
        return counts.format.map((c) =>
          option(c.value, FORMAT_WORDS[c.value] ?? c.value, c.count, facets.formats.includes(c.value), () =>
            setFacets({ ...facets, formats: toggleValue(facets.formats, c.value) }),
          ),
        );
      case 'edited':
        return [
          option('edited', 'Edited', counts.edited.edited, facets.edited === true, () =>
            setFacets({ ...facets, edited: facets.edited === true ? null : true }),
          ),
          option('unedited', 'Not edited', counts.edited.unedited, facets.edited === false, () =>
            setFacets({ ...facets, edited: facets.edited === false ? null : false }),
          ),
        ];
    }
  };

  return (
    <div ref={bar} className={styles.bar} role="group" aria-label="Filters">
      {(Object.keys(TITLES) as FacetName[]).map((name) => {
        const active = summary(facets, name);
        return (
          <div
            key={name}
            className={styles.anchor}
            ref={(el) => {
              if (el) anchors.current.set(name, el);
              else anchors.current.delete(name);
            }}
          >
            <button
              type="button"
              className={styles.chip}
              data-active={active !== null}
              aria-haspopup="dialog"
              aria-expanded={open === name}
              onClick={() => setOpen(open === name ? null : name)}
            >
              {TITLES[name]}
              {active !== null && <span className={styles.value}>: {active}</span>}
              <ChevronDown size={12} />
            </button>
            {open === name && (
              <Popover onClose={close} align="start" label={TITLES[name]}>
                <div className={styles.panel}>{panel(name)}</div>
              </Popover>
            )}
          </div>
        );
      })}
      {hasFacets(facets) && (
        <Button size="sm" variant="ghost" onClick={() => setFacets(NO_FACETS)}>
          <X size={12} />
          Clear filters
        </Button>
      )}
      <span className={styles.spacer} />
      {naming ? (
        <span className={styles.naming}>
          <input
            className={styles.input}
            autoFocus
            placeholder="Name this search"
            aria-label="Name this search"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') {
                e.stopPropagation();
                returnTo.current = saveButton();
                setNaming(false);
              }
            }}
          />
          <Button size="sm" variant="primary" disabled={name.trim() === ''} onClick={save}>
            Save
          </Button>
        </span>
      ) : (
        <Button
          data-save-search
          size="sm"
          variant="ghost"
          disabled={!canSave}
          title={canSave ? 'Keep these filters in the sidebar' : 'Choose a filter or a date first'}
          onClick={() => setNaming(true)}
        >
          <BookmarkPlus size={13} />
          Save search
        </Button>
      )}
    </div>
  );
}
