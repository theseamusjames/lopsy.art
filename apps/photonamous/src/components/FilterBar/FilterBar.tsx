import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookmarkPlus, ChevronDown, ListFilter, Search, X } from 'lucide-react';
import type { LabelChoice, SearchRule } from '@lopsy/photos-core/search/rules';
import { writeSavedSearches } from '@lopsy/photos-core/search/rules';
import { useFindResult, useSavedSearches, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { hasFacets, NO_FACETS, newSavedSearchId, ruleForSaving, toggleValue, type FacetFilter } from '../../library/finding';
import { SORT_DESCENDING, SORT_LABELS, sortDirectionLabel, type SortKey } from '../../library/asset-query';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
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
  arw: 'RAW (Sony)',
  cr2: 'RAW (Canon)',
  nef: 'RAW (Nikon)',
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

const FACETS = Object.keys(TITLES) as FacetName[];

/**
 * Finds and orders the grid's photos: the search field, the filters by
 * camera, lens, rating, label, file type and edits (with counts), the
 * order, and saving the result as a search. Where the row has not the
 * room for all of it on one line, the filters are one menu, opened by a
 * button beside the search field.
 */
export function FilterBar() {
  const session = useSession();
  const result = useFindResult();
  const saved = useSavedSearches();
  const facets = useUi((s) => s.facets);
  const setFacets = useUi((s) => s.setFacets);
  const collection = useUi((s) => s.collection);
  const setCollection = useUi((s) => s.setCollection);
  const sort = useUi((s) => s.sort);
  const setSort = useUi((s) => s.setSort);
  const text = useUi((s) => s.text);
  const setText = useUi((s) => s.setText);
  const [open, setOpen] = useState<FacetName | 'all' | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const anchors = useRef(new Map<FacetName | 'all', HTMLDivElement>());
  const bar = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLLabelElement>(null);
  const chipsMeasure = useRef<HTMLDivElement>(null);
  const endGroup = useRef<HTMLSpanElement>(null);
  /**
   * Whether the row is too narrow for a button for each filter. Measured, not a fixed width: the buttons widen
   * with what they are set to, and the row's room depends on the panels beside it. The buttons' width is read
   * from a hidden copy of them, which is there in both forms of the row.
   */
  const [isCramped, setIsCramped] = useState(false);
  /** The form the row is in. It follows `isCramped`, but not while one of the row's menus is open: ticking a filter must not take its menu away. */
  const [isNarrow, setIsNarrow] = useState(false);
  /** A menu was closed from the keyboard or its own controls: should the row change form, focus goes to the new form's filter button. */
  const closedFromInside = useRef(false);
  const focusAfterChange = useRef(false);
  useLayoutEffect(() => {
    if (open !== null) return;
    if (isCramped !== isNarrow) {
      focusAfterChange.current = closedFromInside.current;
      setIsNarrow(isCramped);
    }
    closedFromInside.current = false;
  }, [open, isCramped, isNarrow]);
  useEffect(() => {
    if (!focusAfterChange.current) return;
    focusAfterChange.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) bar.current?.querySelector<HTMLElement>('[aria-haspopup="dialog"]')?.focus();
  }, [isNarrow]);
  useLayoutEffect(() => {
    const row = bar.current;
    const parts = [searchField.current, chipsMeasure.current, endGroup.current];
    if (!row) return;
    const fit = () => {
      const style = getComputedStyle(row);
      const room = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      const needed = parts.reduce((sum, part) => sum + (part?.getBoundingClientRect().width ?? 0), 0) + gap * (parts.length - 1);
      setIsCramped(needed > room + 0.5);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    for (const el of [row, ...parts]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const saveButton = () => bar.current?.querySelector<HTMLElement>('[data-save-search]') ?? null;
  /** The control focus goes back to when what had it (a popover's checkbox, the name field) goes away. */
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    const active = document.activeElement;
    for (const anchor of anchors.current.values()) {
      if (active !== null && anchor.contains(active)) {
        returnTo.current = anchor.querySelector('button');
        closedFromInside.current = true;
      }
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

  const activeCount = FACETS.filter((name) => summary(facets, name) !== null).length;
  /** Clear filters: in the row, or in the menu, which it closes (the button goes with the last filter, and focus goes back to the menu's). */
  const clear = (inMenu: boolean) => (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        setFacets(NO_FACETS);
        if (inMenu) close();
      }}
    >
      <X size={12} />
      Clear filters
    </Button>
  );

  return (
    <div ref={bar} className={styles.bar} role="group" aria-label="Filters">
      {/* Never seen or reached: the filters' buttons as they would be in the row, for their width. */}
      <div className={styles.measureClip} aria-hidden="true">
        <div ref={chipsMeasure} className={styles.measure}>
          {FACETS.map((name) => {
            const active = summary(facets, name);
            return (
              <span key={name} className={styles.chip}>
                {TITLES[name]}
                {active !== null && <span className={styles.value}>: {active}</span>}
                <ChevronDown size={12} />
              </span>
            );
          })}
          {hasFacets(facets) && (
            <Button size="sm" variant="ghost" disabled tabIndex={-1}>
              <X size={12} />
              Clear filters
            </Button>
          )}
        </div>
      </div>
      <label ref={searchField} className={styles.search}>
        <Search size={14} />
        <input
          type="search"
          placeholder="Find by name, title, keyword"
          aria-label="Find photos"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              if (text !== '') setText('');
              else e.currentTarget.blur();
            }
          }}
        />
      </label>
      {isNarrow && (
        <div
          className={styles.anchor}
          ref={(el) => {
            if (el) anchors.current.set('all', el);
            else anchors.current.delete('all');
          }}
        >
          <button
            type="button"
            className={styles.allButton}
            data-active={activeCount > 0}
            aria-haspopup="dialog"
            aria-expanded={open === 'all'}
            aria-label={activeCount > 0 ? `Filters, ${activeCount} on` : 'Filters'}
            title="Filters"
            onClick={() => setOpen(open === 'all' ? null : 'all')}
          >
            <ListFilter size={14} />
            {activeCount > 0 && <span>{activeCount}</span>}
          </button>
          {open === 'all' && (
            <Popover onClose={close} align="start" label="Filters">
              <div className={styles.allPanel}>
                {FACETS.map((name) => (
                  <div key={name} role="group" aria-label={TITLES[name]} className={styles.facet}>
                    <div className={styles.facetTitle} aria-hidden="true">
                      {TITLES[name]}
                    </div>
                    {panel(name)}
                  </div>
                ))}
              </div>
              {activeCount > 0 && <div className={styles.allFooter}>{clear(true)}</div>}
            </Popover>
          )}
        </div>
      )}
      {!isNarrow && FACETS.map((name) => {
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
      {!isNarrow && hasFacets(facets) && clear(false)}
      {/* The order and Save search keep to the right end, on their own line when the row is too narrow for both. */}
      <span ref={endGroup} className={styles.end}>
        <label className={styles.sort}>
          <span className={styles.sortLabel}>Order</span>
          <select
            value={sort.key}
            aria-label="Order by"
            onChange={(e) => {
              const key = e.target.value as SortKey;
              setSort({ key, descending: SORT_DESCENDING[key] });
            }}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <IconButton
          size="sm"
          label={sortDirectionLabel(sort)}
          icon={sort.descending ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}
          onClick={() => setSort({ ...sort, descending: !sort.descending })}
        />
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
      </span>
    </div>
  );
}
