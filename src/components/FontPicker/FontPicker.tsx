import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { FONT_CATALOG, fontsByFamily } from '../../utils/font-catalog';
import type { FontEntry } from '../../utils/font-catalog';
import { getPreviewImageUrl, extractFamilyName } from '../../utils/font-loader';
import { useVirtualScroll } from './useVirtualScroll';
import styles from './FontPicker.module.css';

const ITEM_HEIGHT = 48;

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
  const currentEntry = fontsByFamily.get(currentFamily);

  const filtered = useMemo(() => {
    if (!search) return FONT_CATALOG;
    const q = search.toLowerCase();
    return FONT_CATALOG.filter((f) => f.family.toLowerCase().includes(q));
  }, [search]);

  const { totalHeight, offsetY, startIndex, endIndex, scrollRef, scrollToTop } =
    useVirtualScroll(filtered.length, ITEM_HEIGHT);

  const combinedScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElRef.current = node;
      scrollRef(node);
    },
    [scrollRef],
  );

  const selectedIndex = useMemo(
    () => filtered.findIndex((f) => f.family === currentFamily),
    [filtered, currentFamily],
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
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < filtered.length) {
            selectEntry(filtered[highlightIndex]!);
          }
          break;
      }
    },
    [close, filtered, highlightIndex, selectEntry],
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
    const entry = filtered[i];
    if (!entry) continue;
    visibleItems.push(
      <FontPickerItem
        key={entry.family}
        entry={entry}
        isSelected={i === selectedIndex}
        isHighlighted={i === highlightIndex}
        onClick={() => selectEntry(entry)}
      />,
    );
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
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
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
            <div className={styles.listContainer} ref={combinedScrollRef}>
              {filtered.length === 0 ? (
                <div className={styles.emptyState}>No fonts found</div>
              ) : (
                <div style={{ height: totalHeight }}>
                  <div style={{ transform: `translateY(${offsetY}px)` }}>
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
  const [imgError, setImgError] = useState(false);

  const className = [
    styles.item,
    isSelected ? styles.itemSelected : '',
    isHighlighted ? styles.itemHighlighted : '',
  ]
    .filter(Boolean)
    .join(' ');

  const showImage = entry.source === 'google' && entry.previewFile && !imgError;
  const showSystemPreview = entry.source === 'system';

  return (
    <div className={className} onClick={onClick} role="option" aria-selected={isSelected}>
      {showImage && (
        <img
          className={styles.previewImage}
          src={getPreviewImageUrl(entry.previewFile!)}
          alt={entry.family}
          onError={() => setImgError(true)}
          loading="lazy"
        />
      )}
      {showSystemPreview && (
        <span
          className={styles.systemFontPreview}
          style={{ fontFamily: `'${entry.family}', ${entry.category}` }}
        >
          {entry.family}
        </span>
      )}
      {!showImage && !showSystemPreview && (
        <span className={styles.fallbackText}>{entry.family}</span>
      )}
      <span className={styles.categoryBadge}>{entry.category}</span>
    </div>
  );
}
