import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { FONT_CATALOG } from '../../utils/font-catalog';
import type { FontEntry, FontCategory } from '../../utils/font-catalog';
import { extractFamilyName, loadGoogleFontPreview } from '../../utils/font-loader';
import { mergeLocalFonts } from '../../utils/local-fonts';
import { useLocalFontsStore, useFontEntry } from '../../app/local-fonts-store';
import { useVirtualScroll } from './useVirtualScroll';
import styles from './FontPicker.module.css';

const ITEM_HEIGHT = 48;

// Installed fonts get their own group ahead of the catalog's categories: the
// user knows what they installed, not which generic it belongs to.
type FontGroup = 'local' | FontCategory;

const GROUP_ORDER: readonly FontGroup[] = [
  'local',
  'sans-serif',
  'serif',
  'display',
  'handwriting',
  'monospace',
];

const GROUP_LABELS: Record<FontGroup, string> = {
  'local': 'Local',
  'sans-serif': 'Sans Serif',
  'serif': 'Serif',
  'display': 'Display',
  'handwriting': 'Handwriting',
  'monospace': 'Monospace',
};

type ListItem =
  | { type: 'header'; group: FontGroup; count: number }
  | { type: 'font'; entry: FontEntry };

function groupOf(entry: FontEntry): FontGroup {
  return entry.source === 'local' ? 'local' : entry.category;
}

function buildGroupedList(fonts: readonly FontEntry[]): ListItem[] {
  const byGroup = new Map<FontGroup, FontEntry[]>();
  for (const font of fonts) {
    const group = groupOf(font);
    let arr = byGroup.get(group);
    if (!arr) {
      arr = [];
      byGroup.set(group, arr);
    }
    arr.push(font);
  }
  for (const arr of byGroup.values()) {
    arr.sort((a, b) => a.family.localeCompare(b.family));
  }
  const items: ListItem[] = [];
  for (const groupKey of GROUP_ORDER) {
    const group = byGroup.get(groupKey);
    if (!group || group.length === 0) continue;
    items.push({ type: 'header', group: groupKey, count: group.length });
    for (const entry of group) {
      items.push({ type: 'font', entry });
    }
  }
  return items;
}

interface FontPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollElRef = useRef<HTMLDivElement | null>(null);

  const currentFamily = extractFamilyName(value);
  const currentEntry = useFontEntry(currentFamily);

  const localEntries = useLocalFontsStore((s) => s.entries);
  const localStatus = useLocalFontsStore((s) => s.status);
  const loadLocalFonts = useLocalFontsStore((s) => s.loadLocalFonts);
  const allFonts = useMemo(() => mergeLocalFonts(FONT_CATALOG, localEntries), [localEntries]);

  const items = useMemo(() => {
    const query = search.toLowerCase();
    const fonts = query ? allFonts.filter((f) => f.family.toLowerCase().includes(query)) : allFonts;
    return buildGroupedList(fonts);
  }, [search, allFonts]);

  // Offer a manual (user-gesture) load whenever we have nothing to show and
  // the browser might still hand fonts over: not yet asked, the prompt was
  // dismissed, or the query resolved empty because access was denied.
  const isLocalLoadOffered =
    localStatus !== 'unsupported' && localStatus !== 'loading' && localEntries.length === 0;

  const { totalHeight, offsetY, startIndex, endIndex, scrollRef, scrollToTop } =
    useVirtualScroll(items.length, ITEM_HEIGHT);

  const combinedScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElRef.current = node;
      scrollRef(node);
    },
    [scrollRef],
  );

  const selectedIndex = useMemo(
    () => items.findIndex((item) => item.type === 'font' && item.entry.family === currentFamily),
    [items, currentFamily],
  );

  const open = useCallback(() => {
    setIsOpen(true);
    setSearch('');
    setHighlightIndex(-1);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setSearch('');
    setHighlightIndex(-1);
  }, []);

  const selectEntry = useCallback(
    (entry: FontEntry) => {
      const fallback = entry.category;
      const familyVal =
        /^[a-zA-Z]+$/.test(entry.family)
          ? `${entry.family}, ${fallback}`
          : `'${entry.family}', ${fallback}`;
      onChange(familyVal);
      close();
    },
    [onChange, close],
  );

  // Click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, close]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [isOpen]);

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightIndex(-1);
    scrollToTop();
  }, [search, scrollToTop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          close();
          triggerRef.current?.focus();
          break;
        case 'ArrowDown': {
          e.preventDefault();
          setHighlightIndex((prev) => {
            let next = prev + 1;
            while (next < items.length && items[next]!.type === 'header') next++;
            return next < items.length ? next : prev;
          });
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setHighlightIndex((prev) => {
            let next = prev - 1;
            while (next >= 0 && items[next]!.type === 'header') next--;
            return next >= 0 ? next : prev;
          });
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const item = items[highlightIndex];
          if (item && item.type === 'font') {
            selectEntry(item.entry);
          }
          break;
        }
      }
    },
    [close, items, highlightIndex, selectEntry],
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0) return;
    const el = scrollElRef.current;
    if (!el) return;
    const itemTop = highlightIndex * ITEM_HEIGHT;
    const itemBottom = itemTop + ITEM_HEIGHT;
    if (itemTop < el.scrollTop) {
      el.scrollTop = itemTop;
    } else if (itemBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = itemBottom - el.clientHeight;
    }
  }, [highlightIndex]);

  const dropdownPos = useMemo(() => {
    if (!isOpen || !triggerRef.current) return { top: 0, left: 0 };
    const rect = triggerRef.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - 360;
    const maxTop = window.innerHeight - 410;
    return {
      top: Math.min(rect.bottom + 4, maxTop),
      left: Math.min(rect.left, maxLeft),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const visibleItems = [];
  for (let i = startIndex; i < endIndex; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.type === 'header') {
      visibleItems.push(
        <div key={`header-${item.group}`} className={styles.groupHeader}>
          <span className={styles.groupLabel}>{GROUP_LABELS[item.group]}</span>
          <span className={styles.groupCount}>{item.count}</span>
        </div>,
      );
    } else {
      visibleItems.push(
        <FontPickerItem
          key={item.entry.family}
          entry={item.entry}
          isSelected={i === selectedIndex}
          isHighlighted={i === highlightIndex}
          onClick={() => selectEntry(item.entry)}
        />,
      );
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => (isOpen ? close() : open())}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={styles.triggerLabel}>
          {currentEntry?.family ?? currentFamily}
        </span>
        <ChevronDown size={12} className={styles.triggerIcon} />
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className={styles.dropdown}
            style={{ '--dropdown-top': `${dropdownPos.top}px`, '--dropdown-left': `${dropdownPos.left}px` } as React.CSSProperties}
            role="listbox"
            onKeyDown={handleKeyDown}
          >
            <div className={styles.searchRow}>
              <input
                ref={searchRef}
                className={styles.searchInput}
                type="text"
                placeholder="Search fonts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search fonts"
              />
            </div>
            {localStatus === 'loading' && (
              <div className={styles.localRow}>
                <span className={styles.localHint}>Loading local fonts…</span>
              </div>
            )}
            {isLocalLoadOffered && (
              <div className={styles.localRow}>
                <button type="button" className={styles.localButton} onClick={() => void loadLocalFonts()}>
                  Load local fonts
                </button>
                {localStatus !== 'idle' && (
                  <span className={styles.localHint}>Allow font access when the browser asks</span>
                )}
              </div>
            )}
            <div className={styles.listContainer} ref={combinedScrollRef}>
              {items.length === 0 ? (
                <div className={styles.emptyState}>No fonts found</div>
              ) : (
                <div className={styles.virtualSpacer} style={{ '--total-height': `${totalHeight}px` } as React.CSSProperties}>
                  <div className={styles.virtualWindow} style={{ '--window-offset': `${offsetY}px` } as React.CSSProperties}>
                    {visibleItems}
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

interface FontPickerItemProps {
  entry: FontEntry;
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: () => void;
}

function FontPickerItem({ entry, isSelected, isHighlighted, onClick }: FontPickerItemProps) {
  useEffect(() => {
    if (entry.source !== 'google') return;
    // css2 subsets the returned face to only the family-name glyphs, so this
    // stays cheap even while many rows scroll through the virtual window.
    // document.fonts re-renders each row in its own face once loaded.
    loadGoogleFontPreview(entry.family, entry.family).catch(() => {
      // If the request fails the row still reads correctly in the category
      // fallback face — no need to signal.
    });
  }, [entry.family, entry.source]);

  const className = [
    styles.item,
    isSelected ? styles.itemSelected : '',
    isHighlighted ? styles.itemHighlighted : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} onClick={onClick} role="option" aria-selected={isSelected}>
      <span
        className={styles.systemFontPreview}
        style={{ '--preview-font': `'${entry.family}', ${entry.category}` } as React.CSSProperties}
      >
        {entry.family}
      </span>
    </div>
  );
}
